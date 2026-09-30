/**
 * Putting a pre-built snapshot into an empty local store.
 *
 * The seeder is not part of the app. It runs at build time, produces every
 * document the app would need, and for the shared project uploads them. For a
 * local-only build it writes them to a file instead — and this is the whole of
 * the app's involvement: copy that file into the store, once, if the store is
 * empty.
 *
 * It is deliberately the dullest possible operation. No CSV is parsed, no name
 * is matched, nothing decides what a default board looks like or which players
 * belong in a class — all of that is the seeder's, and every one of those
 * decisions living in the app is where this project's silent-overwrite bugs came
 * from: a client reading an unreachable store as an empty one and filling it in
 * with its own idea of the truth.
 *
 * Three properties make it safe to run at boot:
 *
 * **It only ever writes into emptiness.** Not "no boards" or "no season" —
 * literally nothing in the collection it is about to write. A store that holds
 * anything is somebody's work.
 *
 * **It is for a LOCAL store only.** A shared project is seeded from outside
 * before anybody signs in. Hydrating one from a browser is the hole that took
 * weeks to find, and the snapshot would be a second source of truth for data
 * ten people share.
 *
 * **It writes through the adapter, not through the app.** The snapshot is
 * grouped by collection, which is exactly how the local adapter stores, so
 * nothing above the adapter has to know a seed exists.
 */

/** Where a build leaves the snapshot. Absent in a build that ships none. */
const SNAPSHOT_URL = 'seed-snapshot.json';

/**
 * @param {object} adapter          the local store, which must not be a shared one
 * @param {object} [options]
 * @param {string} [options.url]    where to fetch the snapshot from
 * @param {Function} [options.fetch]
 * @returns {Promise<{hydrated: boolean, documents: number, reason?: string}>}
 */
export async function hydrateIfEmpty(adapter, { url, fetch: fetcher } = {}) {
    if (!adapter || typeof adapter.load !== 'function') {
        return { hydrated: false, documents: 0, reason: 'no local store' };
    }
    // A store that can be watched is a shared one. Its data comes from the
    // seeder directly and never from a file a browser fetched.
    if (typeof adapter.watch === 'function') {
        return { hydrated: false, documents: 0, reason: 'shared store' };
    }
    if (typeof adapter.collections === 'function' && adapter.collections().length) {
        return { hydrated: false, documents: 0, reason: 'store is not empty' };
    }

    const get = fetcher ?? globalThis.fetch;
    if (typeof get !== 'function') {
        return { hydrated: false, documents: 0, reason: 'nothing to fetch with' };
    }

    let snapshot;
    try {
        const base = globalThis.__SNAPSHOT_BASE ?? '';
        const res = await get(`${base}${url ?? SNAPSHOT_URL}`);
        if (!res?.ok) return { hydrated: false, documents: 0, reason: `no snapshot (HTTP ${res?.status})` };
        snapshot = JSON.parse(await res.text());
    } catch (err) {
        // A build that ships no snapshot is a normal build — the app comes up
        // empty and somebody imports a class. Not an error.
        return { hydrated: false, documents: 0, reason: `no snapshot (${err?.message ?? err})` };
    }

    const collections = snapshot?.collections;
    if (!collections || typeof collections !== 'object') {
        return { hydrated: false, documents: 0, reason: 'snapshot has no collections' };
    }

    // ONE RULE: only ever write into emptiness.
    //
    // An earlier version of this also filled gaps per collection, to finish a
    // hydration a closed tab had interrupted. That is two rules, and they
    // disagree: a store with players but no boards is either a half-written
    // seed or somebody who cleared his boards on purpose, and nothing here can
    // tell those apart. Guessing wrong means laying a snapshot's boards over a
    // class somebody has since replaced — a mixed store that matches neither.
    //
    // So an interrupted hydration leaves a half-seeded app, which is visible and
    // fixable by clearing it, rather than a quietly mixed one. The check above
    // has already established the store is empty.
    let documents = 0;
    for (const [collection, docs] of Object.entries(collections)) {
        if (!docs || typeof docs !== 'object') continue;
        const items = Object.entries(docs).map(([id, doc]) => ({ id, doc }));
        if (!items.length) continue;
        if (adapter.commit) await adapter.commit(collection, items);
        else for (const { id, doc } of items) await adapter.set(collection, id, doc);
        documents += items.length;
    }

    return { hydrated: documents > 0, documents, season: snapshot.season ?? null };
}
