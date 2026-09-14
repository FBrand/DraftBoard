/**
 * Finding the player a pick is about.
 *
 * A pick used to say only his NAME, and every reconciliation between the saved
 * draft and a freshly parsed rankings file matched on it — four separate joins
 * in useDraftState. That is the same "a name is not an identity" fault that
 * put Diego Pounds in the registry twice, sitting in the middle of the draft.
 *
 * What it costs in practice: correct a drafted player's name and his pick stops
 * finding him. He reconciles as somebody the file has never heard of, losing
 * his board metadata — the school, the rank, the tier — and appearing as a
 * stranger who happens to have been drafted.
 *
 * So a pick records `playerId` now, and the join asks for that first.
 *
 * The name join stays as the fallback and is not going anywhere. Picks written
 * before this change have no id; a pick can be somebody the current rankings
 * file has never heard of, who therefore has no record to match against; and an
 * imported CSV carries names and not ids. Falling back is the normal path for
 * all three, not a legacy concession.
 */
import { buildNameIndex, findMatchingIndex } from './nameMatcher';

/**
 * Builds a lookup over `list` that can be asked by id or by name.
 *
 * @param {Array<{id?: string, playerId?: string, name: string}>} list
 */
export function joinIndex(list) {
    const rows = list ?? [];
    const byId = new Map();
    rows.forEach((row, i) => {
        const id = row?.playerId ?? row?.id;
        // First one wins: two rows claiming the same player is a corruption,
        // and quietly taking the later one would hide it.
        if (id && !byId.has(id)) byId.set(id, i);
    });
    return { rows, byId, byName: buildNameIndex(rows) };
}

/**
 * The index of whoever `subject` refers to, or -1.
 *
 * @param {{id?: string, playerId?: string, name: string, position?: string}} subject
 * @param {ReturnType<typeof joinIndex>} index
 */
export function findJoin(subject, index) {
    const id = subject?.playerId ?? subject?.id;
    if (id && index.byId.has(id)) return index.byId.get(id);
    if (!subject?.name) return -1;
    return findMatchingIndex(subject.name, index.byName);
}
