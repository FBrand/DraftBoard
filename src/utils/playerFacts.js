/**
 * Seed data the rankings files cannot carry.
 *
 * A rankings CSV is `group,name,position,favourite` — an analyst's ordering,
 * and nothing about the player himself. School is missing entirely, which is
 * why a scouting card had no school to show and a grouped-by-school list was
 * not possible. The draft outcome is missing too.
 *
 * Both live in the completed draft file, so `scripts/build-player-facts.mjs`
 * derives `public/player_facts_2026.csv` from it and this applies that on
 * load. It is seed data, not truth: anything an analyst has since corrected in
 * the app wins, so this only ever FILLS BLANKS and never overwrites.
 */
import { parseCsvLine } from './csvUtils';
import { loadRegistry, fillMany } from './playerRegistry';
import { repository } from '../data/repository';
import { viewedSeason, seasonIsSeeded } from './boardRegistry';

const FILE = 'player_facts_2026.csv';

// The file is static, so it is fetched once and reused. The APPLYING is not
// once, though — see applyPlayerFacts.
let rowsPromise = null;

function parse(text) {
    const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const header = parseCsvLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map(line => {
        const cells = parseCsvLine(line);
        return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
    }).filter(r => r.name);
}

const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
};

function loadRows() {
    if (rowsPromise) return rowsPromise;
    rowsPromise = fetch(`${import.meta.env.BASE_URL}${FILE}`)
        .then(res => (res.ok ? res.text() : ''))
        .then(parse)
        .catch(() => []);   // seed data is optional; the app works without it
    return rowsPromise;
}

/**
 * Fills in what the rankings files don't say.
 *
 * Deliberately NOT once per page load. Players are registered by more than one
 * path and at more than one moment: the boards register the draft class when
 * the pool loads, and the roster registers its veterans separately, whenever
 * that state is first parsed. A one-shot guard meant whichever ran second got
 * nothing — which is why every veteran on the roster had a blank school while
 * every rookie had one.
 *
 * Running again is cheap and safe: it fills blanks only, and commits once for
 * the whole batch, so a pass with nothing to do writes nothing at all.
 */
/**
 * Names as a key, matched the way the builder wrote them.
 *
 * Deliberately a hash lookup and NOT the fuzzy resolver. The seed covers the
 * whole league now — 2,474 players, because a veteran needs a school too — and
 * resolving that list through resolveAll meant fuzzy-matching every row
 * against the registry on each pass. That blocked the main thread for
 * fourteen seconds: the page rendered one frame in two, every Playwright
 * actionability check timed out against an element that was plainly visible,
 * and the renderer eventually ran out of memory.
 *
 * The direction was the mistake. We do not need to find a record for every
 * row in the file; we need a row for the few hundred records we actually
 * hold. Walking the registry and looking each player up by name is one pass
 * over the records and a hash hit per player.
 */
const norm = (s) => String(s ?? '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[.,'`’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

let byName = null;

function index(rows) {
    if (byName) return byName;
    byName = new Map();
    rows.forEach(r => {
        const key = norm(r.name);
        if (key && !byName.has(key)) byName.set(key, r);
    });
    return byName;
}

/**
 * Whether the shipped facts have already been laid over this season.
 *
 * This used to run on every load and fill any record that was missing a school
 * or a draft outcome. That was fine while the draft lived in its own store:
 * the file described what really happened, the picks described what this
 * session did, and neither touched the other.
 *
 * The draft is the player's record now — a pick IS `draftPick` on the player —
 * so refilling blanks on every load means clearing the draft does not stick.
 * Null out a player's pick, reload, and the file puts it straight back. The
 * seed has to be a thing that happened once, not a thing that keeps happening.
 *
 * Recorded beside the data rather than in this browser, for the same reason
 * the season marker is: whoever gets there first seeds, everybody else reads
 * the marker and does nothing.
 */
const SEEDED = 'setup';
const seedMarker = (seasonId) => `facts__${seasonId}`;

export function factsSeeded(seasonId) {
    return !!seasonId && !!repository.get(SEEDED, seedMarker(seasonId));
}

export async function applyPlayerFacts() {
    const seasonId = viewedSeason()?.id ?? null;
    await repository.ready(SEEDED);
    // A season that has been seeded keeps whatever the app has since decided,
    // including a deliberately emptied draft.
    if (seasonId && factsSeeded(seasonId)) return false;

    const rows = await loadRows();
    if (!rows.length) return false;

    const outcomesApply = seasonIsSeeded();
    const lookup = index(rows);

    // Only players we hold, and only the ones still missing something — a
    // record that already has its school and its draft outcome is not worth a
    // lookup, and this runs again whenever new players are registered.
    const updates = [];
    loadRegistry().forEach(record => {
        if (outcomesApply
            ? (record.school && record.team && (record.draftPick != null || record.isUdfa != null))
            : !!record.school) return;
        const row = lookup.get(norm(record.name));
        if (!row) return;
        updates.push({
            id: record.id,
            base: { school: row.school },
            // The school is true whatever season you are in. The DRAFT OUTCOME
            // is not: it is what happened in the shipped 2026 season, and with
            // the draft living on the player record, seeding it into a season
            // nobody has drafted yet would show that season's board as already
            // complete. A season started in the app drafts its own class.
            facts: outcomesApply ? {
                draftYear: num(row.draftYear),
                draftRound: num(row.draftRound),
                draftPick: num(row.draftPick),
                team: row.team || null,
                isUdfa: num(row.draftPick) != null ? false : null,
            } : {},
        });
    });

    const filled = fillMany(updates) > 0;
    if (seasonId) {
        repository.set(SEEDED, seedMarker(seasonId), {
            seasonId, at: new Date().toISOString(),
        });
    }
    return filled;
}
