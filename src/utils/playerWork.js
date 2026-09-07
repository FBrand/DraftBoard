/**
 * Whether anybody has done work on a player.
 *
 * Deleting a player is meant for a mistake — a name typed twice, somebody
 * entered who was never in the class. It is not meant to be a way to lose an
 * analyst's work, and it silently was: a delete took the player out from under
 * every board, remarks and placements included, with nothing to undo it.
 *
 * So a player nobody has touched is still freely deletable, and one who has
 * been placed, tagged or written about is not. What you can always do is clear
 * YOUR OWN opinions of him, which is the thing somebody actually wants when
 * they reach for delete on a player who turns out to be someone else's.
 */
import { allBoards } from './boardRegistry';
import * as scoutingState from './scoutingState';
import { remarksFor, ownerIdFor } from './evaluations';
import { buildNameIndex, findMatchingIndex } from './nameMatcher';

const placed = (entry) => !!entry && (entry.round != null || entry.tier != null || !!entry.tag);

/** The entry a board holds for this player, by id where there is one. */
function entryOn(board, player) {
    const entries = scoutingState.loadState(board.id).entries ?? [];
    if (player?.id) {
        const hit = entries.find(e => e.playerId === player.id);
        if (hit) return hit;
    }
    if (!player?.name) return null;
    // Name only: a board may record a different position for the same man.
    const at = findMatchingIndex(player.name, buildNameIndex(entries));
    return at === -1 ? null : entries[at];
}

/**
 * Every board that has placed, tagged or written about this player, with what
 * it holds. Empty means nobody has done anything and he is safe to delete.
 */
export function workOn(player) {
    if (!player) return [];

    return allBoards().map(board => {
        const entry = entryOn(board, player);
        const ownerId = ownerIdFor(board);
        const remarks = ownerId && player.id ? remarksFor(ownerId, player.id) : [];
        return { board, entry, remarks, has: placed(entry) || remarks.length > 0 };
    }).filter(row => row.has);
}

/** True when nobody has done anything with him. */
export const isUntouched = (player) => workOn(player).length === 0;

/** A short list of who has, for telling somebody why they can't delete him. */
export const whoHasWorkedOn = (player) => workOn(player).map(r => r.board.label);
