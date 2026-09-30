/**
 * Marks every player who is in a season's pool, on the player.
 *
 * So a listener can be scoped to one season — `where('i', 'array-contains',
 * seasonId)` — instead of watching the whole registry.
 *
 * Firestore bills a listener's initial snapshot per document returned, and the
 * registry is watched rather than read: a pick is a fact on a player and the live
 * draft follows the collection. Measured, an unscoped listener costs 720 reads on
 * every boot for a board that names 328 of them, and five seasons of players make
 * that worse every year while the pool stays the same size.
 *
 * Phase 6 called this "read the registry by reference", which cannot work as
 * written — fetching 328 documents by id would not remove the listener, and the
 * listener is what costs. Scoping the listener is the version of that idea that
 * survives how picks are stored.
 *
 * The seeder does it because it knows the pool: it has just written the entries,
 * and a board's entries ARE the answer to who is in the pool.
 */
import { repository } from '../../src/data/repository.js';
import { entriesPath } from '../../src/data/boardEntries.js';
import { PLAYERS } from '../../src/utils/playerRegistry.js';
import { playerFields } from '../../src/data/fieldNames.js';

/**
 * @param {string} seasonId
 * @param {string[]} boardIds
 * @returns {number} how many players were marked
 */
export function stampPools(seasonId, boardIds) {
    if (!seasonId || !boardIds?.length) return 0;

    // Every player any of this season's boards has an entry for. The entry's
    // document id IS the player id — see boardEntries — so this needs no lookup.
    const inPool = new Set();
    boardIds.forEach((boardId) => {
        Object.keys(repository.docs(entriesPath(boardId)) ?? {}).forEach(id => inPool.add(id));
    });
    if (!inPool.size) return 0;

    const players = repository.docs(PLAYERS) ?? {};
    const changes = [];
    inPool.forEach((id) => {
        const doc = players[id];
        if (!doc) return;
        const fat = playerFields.fat(doc);
        const pools = Array.isArray(fat.inPools) ? fat.inPools : [];
        if (pools.includes(seasonId)) return;
        changes.push({ id, doc: playerFields.lean({ ...fat, inPools: [...pools, seasonId] }) });
    });

    // One commit, not one per player: the registry is a single key in the local
    // store, so per-player writes serialise the whole collection each time —
    // 700-odd rewrites of a 90KB document, which has crashed a renderer here.
    if (changes.length) repository.commit(PLAYERS, changes);
    return changes.length;
}
