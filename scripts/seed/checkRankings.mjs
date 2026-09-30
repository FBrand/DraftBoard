/**
 * A rankings file that contradicts itself, reported where the file is read.
 *
 * The app used to check this on every load and show a banner: "Dan rates Arvell
 * Reese 2 times — 3.4 and 5.3. The first is used." It was worth saying, because
 * before that the duplicate was resolved by line order and never mentioned, so
 * the board rendered as though the file had said one thing.
 *
 * The app does not read the files any more, so the check cannot live there: a
 * pool built from board entries is one document per player and a duplicate is
 * impossible by construction. The banner could never fire again, which makes it
 * dead UI rather than a safeguard.
 *
 * So the check moves to the seeder, which does read the files, and reports at the
 * moment somebody can still fix the CSV — before 1777 documents are built out of
 * it. Printed rather than thrown: a contradictory row is resolved by order and
 * the seed is still usable, and stopping the build over it would be worse than
 * saying so.
 */
import { readFileSync } from 'node:fs';
import { parseRankings } from '../../src/utils/dataParser.js';
import { identityKey } from '../../src/utils/nameMatcher.js';

/**
 * The contradictions in already-parsed files, keyed however the caller keys
 * them. Pure, so it can be tested without a filesystem — which is what the
 * existing suite does, and the reason this is separate from reading a file.
 *
 * @param {Record<string, Array>} files
 */
export function duplicatesInParsed(files) {
    const out = [];
    Object.entries(files ?? {}).forEach(([boardId, file]) => {
        const counts = new Map();
        (file ?? []).filter(x => x?.name).forEach((x) => {
            const key = identityKey(x.name, x.position);
            const seen = counts.get(key);
            if (seen) seen.rows.push(x);
            else counts.set(key, { name: x.name, position: x.position, rows: [x] });
        });
        counts.forEach((v) => {
            if (v.rows.length < 2) return;
            out.push({
                boardId,
                name: v.name,
                position: v.position,
                count: v.rows.length,
                // What the rows actually disagree about, which is the part worth
                // showing: "3.4 and 5.3" says more than "twice".
                placements: v.rows.map(r => (r.round == null ? 'unranked' : `${r.round}.${r.tier ?? 1}`)),
            });
        });
    });
    return out;
}

/** The same, for one file on disk. */
export function duplicatesInFile(path) {
    const name = path.split('/').pop();
    return duplicatesInParsed({ [name]: parseRankings(readFileSync(path, 'utf8')) || [] })
        .map(d => ({ ...d, file: name }));
}

/** Reports every contradiction across the files given. Returns how many. */
export function reportRankingDuplicates(paths) {
    const all = paths.flatMap((path) => {
        try { return duplicatesInFile(path); } catch { return []; }
    });
    if (!all.length) return 0;

    console.warn(`\n${all.length} contradictory row(s) in the rankings files — the FIRST of each is used:`);
    all.forEach(d => console.warn(`  ${d.file}: ${d.name} appears ${d.count} times — ${d.placements.join(' and ')}`));
    console.warn('');
    return all.length;
}
