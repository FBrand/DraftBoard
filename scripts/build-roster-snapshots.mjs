/**
 * Derives the earlier roster snapshots from `public/roster.csv`.
 *
 * roster.csv is the roster as it stands the day before cutdown — the end of
 * the offseason. The two earlier states are not separately maintained lists,
 * because a separately maintained list drifts: they are DERIVED from the
 * provenance suffix roster.csv already carries on every name, so a correction
 * to the roster propagates backwards instead of leaving three files
 * disagreeing about who was on the team.
 *
 *   :FA    signed in 2026 free agency   -> after the season ended, before the draft
 *   :UDFA  signed after the 2026 draft  -> after the draft
 *   :N     drafted in the 2026 draft    -> the draft itself (bare round number)
 *   :YY/R  drafted in a previous year   -> a holdover
 *   :IR    a designation, not an arrival
 *   (none) a holdover
 *
 * Produces:
 *   roster_2025_end.csv  last season's roster: holdovers only. Free agency
 *                        starts here, and Roster takes its empty shape from it.
 *   roster_predraft.csv  the day before the draft: holdovers + FA signings.
 *                        This is what Free Agency looks like once it is done.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../public/', import.meta.url);
const src = readFileSync(new URL('roster.csv', ROOT), 'utf8');

const THIS_DRAFT = /^\d{1,2}$/;

/** How a player on this roster got here, read off the suffix on his name. */
function arrival(cell) {
    // `R:` marks a reserve/practice-squad slot and is a zone, not an arrival.
    const name = cell.replace(/^(R|PS|IR):/, '');
    const at = name.lastIndexOf(':');
    if (at === -1) return 'holdover';
    const suffix = name.slice(at + 1).trim().toUpperCase();
    if (suffix === 'UDFA') return 'udfa';
    if (suffix === 'FA') return 'fa';
    if (THIS_DRAFT.test(suffix)) return 'draft';
    return 'holdover';                      // :YY/R, :IR, :TR — already here
}

function snapshot(keep) {
    return src.split('\n').map((line, i) => {
        if (!line.trim()) return null;
        if (i === 0) return line;                    // header

        const cells = line.split(',');
        // Specialists list players from the third field; every other phase has
        // a slots53 count in front of them.
        const firstPlayer = cells[0] === 'S' ? 2 : 3;
        const head = cells.slice(0, firstPlayer);
        const players = cells.slice(firstPlayer)
            .filter(c => c.trim() && keep(arrival(c.trim())));

        // A position row with nobody left still belongs in the file: it is the
        // shape of the depth chart, and dropping it would leave the players
        // arriving later with nowhere to land.
        return [...head, ...players].join(',');
    }).filter(Boolean).join('\n') + '\n';
}

const outputs = [
    ['roster_2025_end.csv', (a) => a === 'holdover'],
    ['roster_predraft.csv', (a) => a === 'holdover' || a === 'fa'],
];

for (const [file, keep] of outputs) {
    const text = snapshot(keep);
    writeFileSync(new URL(file, ROOT), text);
    const count = text.split('\n').slice(1).filter(Boolean)
        .reduce((n, l) => n + l.split(',').slice(l.startsWith('S,') ? 2 : 3).filter(c => c.trim()).length, 0);
    console.log(`${file}: ${count} players`);
}

const total = src.split('\n').slice(1).filter(Boolean)
    .reduce((n, l) => n + l.split(',').slice(l.startsWith('S,') ? 2 : 3).filter(c => c.trim()).length, 0);
console.log(`roster.csv (day before cutdown): ${total} players`);
