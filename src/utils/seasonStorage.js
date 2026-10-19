/**
 * What the browser is holding, and who is still referenced by it.
 *
 * One season measures about 152KB. Against a localStorage cap of roughly 5MB
 * that is thirty-odd seasons, so none of this is urgent — it is a safety net,
 * and the reason to build it now is that a net nobody can trigger is a net
 * nobody has tested. `FILLER_KEY` exists for exactly that.
 *
 * Two facts about the shape of storage decide the design:
 *
 *   - A season owns its charts, its setup, and the entries of the boards that
 *     belong to it. Dropping a season reclaims those.
 *   - `db_players` is GLOBAL and is the single largest key — 86KB of a 152KB
 *     season. It is not season-scoped, so eviction alone never shrinks it, and
 *     the registry is the part that grows with every draft class. Pruning it
 *     needs to know who is still referenced, which is what this module is for.
 */

const PREFIX = 'db_';

/** A deliberately large key, so the threshold can be reached on demand. */
export const FILLER_KEY = 'storage_filler_v1';

const raw = (key) => {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};

/**
 * Bytes held, counted the way the browser charges for them: key plus value.
 *
 * `navigator.storage.estimate()` is the wrong instrument here and was measured
 * saying so — it reported 0.0KB while 152KB sat in localStorage, because it
 * counts IndexedDB and caches. Its quota is the origin's overall budget, not
 * the localStorage cap this app lives under.
 */
export function storageUsage() {
    let bytes = 0;
    const byKey = [];
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (!key) continue;
            const size = key.length + raw(key).length;
            bytes += size;
            byKey.push({ key, size });
        }
    } catch { /* a storage that will not enumerate cannot be measured */ }
    byKey.sort((a, b) => b.size - a.size);
    return { bytes, keys: byKey.length, byKey };
}

/** Every key belonging to one season: its charts, its setup, its boards' entries. */
export function seasonKeys(seasonId, boardIdsInSeason = []) {
    if (!seasonId) return [];
    const owned = [];
    const seasonPrefix = `${PREFIX}seasons/${seasonId}/`;
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (key.startsWith(seasonPrefix)) { owned.push(key); continue; }
            if (boardIdsInSeason.some(id => key === `${PREFIX}boards/${id}/entries`)) owned.push(key);
        }
    } catch { /* ignore */ }
    return owned;
}

/** What dropping that season would reclaim. */
export function seasonFootprint(seasonId, boardIdsInSeason = []) {
    return seasonKeys(seasonId, boardIdsInSeason)
        .reduce((total, key) => total + key.length + raw(key).length, 0);
}

const parse = (key) => {
    try { return JSON.parse(raw(key) || '{}'); } catch { return {}; }
};

/**
 * Every player still spoken for by the seasons being kept.
 *
 * Exact, not fuzzy. A board entry's document KEY is the player's id, and a
 * depth-chart slot carries `playerId` now — so this is set membership rather
 * than name matching. That matters more here than anywhere else in the app: a
 * false negative does not mislabel a card, it deletes somebody who is still
 * referenced and leaves the slot pointing at nothing.
 *
 * A slot with no id contributes nothing, so anything it holds is treated as
 * unreachable — which is why pruning must never run while ids are missing.
 * `unresolvedSlots` reports that, and it is the caller's job to refuse.
 */
export function reachablePlayerIds(seasonIds = [], boardIdsBySeason = {}) {
    const keep = new Set();
    let unresolvedSlots = 0;

    seasonIds.filter(Boolean).forEach((seasonId) => {
        (boardIdsBySeason[seasonId] ?? []).forEach((boardId) => {
            Object.keys(parse(`${PREFIX}boards/${boardId}/entries`)).forEach(id => keep.add(id));
        });

        const chartPrefix = `${PREFIX}seasons/${seasonId}/charts/`;
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(chartPrefix) || !key.endsWith('/rows')) continue;
                Object.values(parse(key)).forEach((row) => {
                    (row?.s ?? row?.slots ?? []).forEach((slot) => {
                        if (!slot) return;
                        const id = slot.i ?? slot.playerId;
                        if (id) keep.add(id);
                        else if (slot.n ?? slot.name) unresolvedSlots += 1;
                    });
                });
            }
        } catch { /* ignore */ }
    });

    return { keep, unresolvedSlots };
}

/** Puts `mb` megabytes into storage so the threshold can actually be reached. */
export function addFiller(mb = 3) {
    try {
        localStorage.setItem(FILLER_KEY, 'x'.repeat(Math.round(mb * 1024 * 1024)));
        return true;
    } catch { return false; }
}

export function clearFiller() {
    try { localStorage.removeItem(FILLER_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

/**
 * Which season to drop when the cap is reached: the OLDEST BY YEAR, never the
 * one being worked in.
 *
 * By year rather than least-recently-used, because opening an archived season
 * to read it would otherwise evict the season you are living in.
 */
export function oldestEvictable(seasons = [], currentSeasonId = null) {
    return seasons
        .filter(s => s?.id && s.id !== currentSeasonId)
        .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))[0] ?? null;
}

/**
 * Drops a season, and any player nobody is left pointing at.
 *
 * Refuses twice, and both refusals are the point:
 *
 *   - **Unflushed writes.** The queue holds changes that have not reached the
 *     store. Dropping a season while it does throws them away silently, which
 *     is the precise failure the queue exists to prevent. Flush first.
 *   - **A slot with no id.** Reachability is set membership on ids; a slot
 *     that cannot say who it holds contributes nobody, so pruning on it would
 *     delete a man who IS on a roster. Refuse rather than guess.
 *
 * Goes through the repository rather than localStorage: deleting keys directly
 * leaves the in-memory copy to put them straight back.
 */
export async function evictSeason({
    repository,
    seasonId,
    boardIds = [],
    survivingSeasonIds = [],
    boardIdsBySeason = {},
}) {
    if (!seasonId) return { ok: false, reason: 'no-season' };

    const sync = repository.syncState?.() ?? { pending: 0 };
    if (sync.pending > 0) return { ok: false, reason: 'unflushed', pending: sync.pending };

    const { keep, unresolvedSlots } = reachablePlayerIds(survivingSeasonIds, boardIdsBySeason);
    if (unresolvedSlots > 0) return { ok: false, reason: 'unresolved-slots', unresolvedSlots };

    const reclaimed = seasonFootprint(seasonId, boardIds);
    const collections = seasonKeys(seasonId, boardIds).map(key => key.slice(PREFIX.length));
    for (const collection of collections) await repository.clear(collection);

    // The registry is global, so it only shrinks here. One commit rather than a
    // write per player: the roster import learned that lesson the hard way.
    const all = Object.keys(parse(`${PREFIX}players`));
    const orphans = all.filter(id => !keep.has(id));
    if (orphans.length) {
        await repository.commit('players', orphans.map(id => ({ id, doc: null })));
        for (const id of orphans) await repository.clear(`evaluations/${id}/remarks`);
    }

    return { ok: true, reclaimed, collections: collections.length, pruned: orphans.length };
}
