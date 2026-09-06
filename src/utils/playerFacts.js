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

let applied = false;

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

/**
 * Fills in what the rankings files don't say. Runs once per page load, after
 * the pool has been resolved so there are records to fill.
 */
export async function applyPlayerFacts() {
    if (applied) return false;
    applied = true;

    let rows;
    try {
        const res = await fetch(`${import.meta.env.BASE_URL}${FILE}`);
        if (!res.ok) return false;
        rows = parse(await res.text());
    } catch {
        return false;   // seed data is optional; the app works without it
    }
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
