/**
 * Who a name is, according to what is already written down.
 *
 * The registry's own header says the fuzzy match belongs at first resolution
 * "and never again on the read path". Three separate places on the boot path
 * were doing it again anyway, over the whole pool, on every single load — and
 * a profile of a warm boot on a 4x-throttled phone (roughly a mid-range
 * handset, which is how the 25s figure was measured) put
 * `getLevenshteinDistance` at the top by self time, every time.
 *
 * None of that work discovers anything. A board entry IS the answer: its
 * document key is the player's registry id, which is exactly why the entry
 * body deliberately stores no `playerId` of its own. This reads those keys
 * back into a name -> id map so the matcher is only asked about names nothing
 * accounts for — a genuinely new prospect, or a first run where there are no
 * entries yet and the map is empty.
 *
 * Nothing here is persisted, so there is no stale mapping to invalidate: the
 * map is rebuilt from storage on every load, and a name it cannot answer for
 * falls through to precisely the code that ran before.
 */
import { readEntries } from '../data/boardEntries';
import { listBoards } from './boardRegistry';
import { identityKey, nameKey } from './nameMatcher';

/**
 * @returns {Map<string, string>} identity/name key -> playerId
 */
export function storedIdentities() {
    const map = new Map();
    listBoards().forEach((board) => {
        readEntries(board.id).forEach((entry) => {
            if (!entry.playerId || !entry.name) return;
            // Both keys: the qualified one wins where two men share a name,
            // and the bare name answers when a file omits the position.
            const qualified = identityKey(entry.name, entry.position);
            if (!map.has(qualified)) map.set(qualified, entry.playerId);
            const bare = nameKey(entry.name);
            if (!map.has(bare)) map.set(bare, entry.playerId);
        });
    });
    return map;
}

/** The id stored for `player`, or null if nothing has one for him. */
export function storedIdFor(map, player) {
    if (!player?.name) return null;
    return map.get(identityKey(player.name, player.position))
        ?? map.get(nameKey(player.name))
        ?? null;
}
