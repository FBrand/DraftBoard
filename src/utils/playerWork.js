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
import { allBoards, voiceName } from './boardRegistry';
import * as scoutingState from './scoutingState';
import { voicesFor } from './evaluations';
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
 * Every board that has placed or tagged this player, with what it holds.
 *
 * Placements only. Remarks used to be counted here too, fetched under each
 * board's author — which asked a board whose opinion it held, and so missed
 * everything written by anybody who was not that board's author. A remark is a
 * person's opinion; see voicesOn.
 */
export function workOn(player) {
    if (!player) return [];

    return allBoards().map(board => {
        const entry = entryOn(board, player);
        return { board, entry, has: placed(entry) };
    }).filter(row => row.has);
}

/**
 * Everybody who has written about this player, by name.
 *
 * Independent of boards in both directions: somebody who has never owned a
 * board still counts as having done work on him, and a board is never asked
 * whose words these are.
 */
export function voicesOn(player) {
    if (!player?.id) return [];
    return voicesFor(player.id)
        .map(({ voiceId, remarks }) => ({
            voiceId,
            label: voiceName(voiceId) ?? 'Unattributed',
            remarks,
        }));
}

/** True when nobody has placed him and nobody has written about him. */
export const isUntouched = (player) => workOn(player).length === 0 && voicesOn(player).length === 0;

/**
 * A short list of who has, for telling somebody why they can't delete him.
 *
 * Boards for placements, people for remarks — the two are different kinds of
 * work and the sentence reads as a list of both.
 */
export const whoHasWorkedOn = (player) => [
    ...workOn(player).map(r => r.board.label),
    ...voicesOn(player).map(v => v.label),
].filter((name, i, all) => all.indexOf(name) === i);
