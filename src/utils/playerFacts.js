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
import { resolveAll, fillMany } from './playerRegistry';

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
export async function applyPlayerFacts() {
    const rows = await loadRows();
    if (!rows.length) return false;

    // Resolved with the school included, so a namesake at a different school
    // is not handed the wrong record.
    const ids = resolveAll(
        rows.map(r => ({ name: r.name, position: r.position, school: r.school })),
        { create: false },
    );

    // One commit, not one per player: the per-player calls each rewrite the
    // whole collection, and 257 rows of seed data crashed the renderer.
    const updates = [];
    rows.forEach((row, i) => {
        const id = ids[i];
        if (!id) return;                 // not on any board — nothing to fill
        updates.push({
            id,
            base: { school: row.school },
            facts: {
                draftYear: num(row.draftYear),
                draftRound: num(row.draftRound),
                draftPick: num(row.draftPick),
                team: row.team || null,
                isUdfa: num(row.draftPick) != null ? false : null,
            },
        });
    });

    return fillMany(updates) > 0;
}
