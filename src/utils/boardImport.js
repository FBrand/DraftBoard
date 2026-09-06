/**
 * Reading a whole board back in from a spreadsheet.
 *
 * The other CSV paths each do a piece of this: `scoutingState.parseCSV` is a
 * faithful round-trip of the app's own export (every internal column, written
 * for a machine), and `prospects.parseProspectCSV` adds players without
 * placing them. Neither is what somebody types in Google Sheets when they have
 * a ranking on paper and want it in the app — that file is
 * `round, tier, name, position, school, tag, evaluation` (see boardCsv.js),
 * and it has to do three things at once:
 *
 *   - place players the board already knows about,
 *   - create the ones it doesn't, and
 *   - carry the analyst's remarks in with them.
 *
 * An import REPLACES the board's placements, because the file is a ranking and
 * a ranking is an ordering — merging it into an existing one would produce an
 * order nobody wrote. Remarks are the exception: they belong to the author
 * rather than the board, so they are added and never dropped.
 */
import { parseBoardCSV } from './boardCsv';
import * as scoutingState from './scoutingState';
import { spaceEvenly } from './boardRanking';
import { resolveAll } from './playerRegistry';
import { addProspect } from './prospects';
import { ownerIdFor, remarksFor, addRemark } from './evaluations';
import { currentSeason } from './boardRegistry';

/**
 * Applies a parsed file to one board. Returns what it did, so the caller can
 * say so rather than the import being silent.
 */
export function applyBoardRows(board, rows) {
    const result = { placed: 0, created: 0, remarks: 0 };
    if (!board || !rows?.length) return result;

    // Resolve against the registry first, without creating: a name already on
    // some other analyst's board is the same man, and must land on his
    // existing record rather than a second one.
    const candidates = rows.map(r => ({ name: r.name, position: r.position, school: r.school }));
    const ids = resolveAll(candidates, { create: false });

    // Anyone left is genuinely new. He goes in as base data — shared by every
    // board, exactly like a player typed into Add Players — and is then
    // resolved again so he has an id to be placed and annotated under.
    const missing = ids.map((id, i) => (id ? null : i)).filter(i => i !== null);
    if (missing.length) {
        missing.forEach(i => {
            addProspect({ name: rows[i].name, position: rows[i].position, school: rows[i].school });
            result.created += 1;
        });
        const filled = resolveAll(missing.map(i => candidates[i]), { create: true });
        missing.forEach((rowIndex, n) => { ids[rowIndex] = filled[n]; });
    }

    // Position inside a tier comes from the order the rows appear in — that
    // ordering is what the analyst typed, and it is the whole point of the
    // file. Spaced rather than consecutive so a later drag writes one number.
    const seenInTier = new Map();
    const entries = rows.map((row, i) => {
        const key = `${row.round ?? ''}.${row.tier ?? ''}`;
        const nth = seenInTier.get(key) ?? 0;
        seenInTier.set(key, nth + 1);

        const entry = scoutingState.makeEntry(row.name, row.position, row.school, ids[i]);
        result.placed += 1;
        return {
            ...entry,
            round: row.round,
            tier: row.tier,
            withinGroup: row.round == null ? null : spaceEvenly(nth),
            tag: row.tag ?? null,
        };
    });

    const previous = scoutingState.loadState(board.id);
    scoutingState.saveState(board.id, {
        ...previous,
        entries,
        // The file has now created this board's state, so it must not be
        // re-seeded from the rankings file on the next load and thrown away.
        seeded: true,
    });

    // Remarks go to the author, not the board. Added rather than replaced, and
    // deduplicated by text so re-importing a corrected file doesn't leave two
    // copies of every note.
    const ownerId = ownerIdFor(board);
    const seasonId = currentSeason()?.id ?? null;
    if (ownerId) {
        rows.forEach((row, i) => {
            const playerId = ids[i];
            if (!playerId || !row.remarks?.length) return;
            const already = new Set(remarksFor(ownerId, playerId).map(r => `${r.kind}|${r.text}`));
            row.remarks.forEach(r => {
                if (already.has(`${r.kind}|${r.text}`)) return;
                addRemark(ownerId, playerId, r.kind, r.text, seasonId);
                already.add(`${r.kind}|${r.text}`);
                result.remarks += 1;
            });
        });
    }

    return result;
}

/** Convenience for the file-input path: text in, summary out. */
export function importBoardCSV(board, text) {
    return applyBoardRows(board, parseBoardCSV(text));
}
