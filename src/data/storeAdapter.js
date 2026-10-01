/**
 * The layered store, shaped like an adapter.
 *
 * This replaced overlayAdapter.js, which is deleted.
 *
 * The overlay existed to merge two stores — remote and local, local winning, with
 * tombstones for a deletion the local half has to remember — and to route a write
 * to one or the other depending on whether this person's writes are accepted. The
 * layered store does all of that, in terms that are named: `shared` is what the
 * backend said, `mine` is this person's own work, `unsent` is issued and
 * unacknowledged, and refused work is a fourth state that is never merged into a
 * read.
 *
 * So rather than migrating a hundred call sites off the repository, the
 * repository's ADAPTER becomes the store. Every caller keeps the API it has; the
 * merging moves from a place where it was two anonymous halves to a place where
 * the layers have names and precedence is stated once.
 *
 * What is deliberately NOT here:
 *
 * - **No `loadSync`.** Its absence is the feature, and the overlay said so too: a
 *   synchronous read can only answer from the local half, which for a viewer who
 *   has changed nothing is an empty board returned instantly and confidently.
 *   Worse than not answering.
 * - **No `remoteDocs`.** A caller that wants what the store said asks
 *   `store.shared()`, which is the question with its own name.
 */
import { createStore } from './store';
import { requireBackend } from './contract';

/**
 * @param {object} backend   a contract backend — the REMOTE one, with no local
 *   half: the local half is the `mine` layer now.
 * @param {object} [options]
 * @param {() => boolean} [options.canWrite]   whether writes may be published
 * @param {Function} [options.onRemoteError]
 */
export function createStoreAdapter(backend, { canWrite, onRemoteError } = {}) {
    requireBackend(backend);

    const store = createStore(backend, {
        canWrite,
        onWatchError: (collection, error) => onRemoteError?.(collection, error),
    });

    // Which paths have been read. See load().
    const read = new Set();

    const adapter = {
        name: `store(${backend.name})`,

        /**
         * Every layer, merged in the stated order.
         *
         * Read ONCE per path, which is the repository's own contract — it keeps
         * a `loaded` set and calls this when a collection is first wanted. The
         * guard belongs here and not in the store: a complete read REPLACES the
         * shared layer, so re-reading a collection that is being followed throws
         * away every snapshot since. Measured — a pushed document vanished on the
         * next load.
         *
         * The store keeps `ready` re-readable on purpose, because that is how a
         * delta applies onto what is already held.
         */
        async load(path) {
            if (read.has(path)) return store.view(path);
            read.add(path);
            try {
                await store.ready(path);
            } catch (err) {
                // A failed read is reported and then answered from what this
                // person has, which is the whole reason a viewer sees his own work
                // rather than a blank page when the network is gone.
                onRemoteError?.(path, err);
            }
            return store.view(path);
        },

        async set(path, id, doc, opts) {
            await store.write([{ collection: path, id, doc, mine: opts?.mine, merge: opts?.merge }]);
        },

        async remove(path, id, opts) {
            await store.write([{ collection: path, id, doc: null, mine: opts?.mine }]);
        },

        async commit(path, changes, opts) {
            await store.write((changes ?? []).map(c => ({
                collection: path, id: c.id, doc: c.doc, merge: c.merge, mine: opts?.mine,
            })));
        },

        async commitMany(items, opts) {
            await store.write((items ?? []).map(c => ({
                collection: c.path, id: c.id, doc: c.doc, merge: c.merge, mine: opts?.mine,
            })));
        },

        /** Drops what the store said and what is mine, for this collection. */
        async clear(path) {
            store.forget(path);
            read.delete(path);
        },

        identity: () => store.identity(),
        isExpert: () => (canWrite ? canWrite() : false),
        newAuthorId: taken => backend.newIdentity?.(taken) ?? null,

        /** Whether the last read of this collection failed. */
        readFailed: path => store.readiness(path).failed,

        /** The store underneath, for a caller that needs a layer by name. */
        store,
    };

    if (backend.capabilities.push) {
        adapter.watch = (path, onChange, onError) => {
            // Following a collection IS having read it, so a later load() must not
            // re-read: a complete read replaces the shared layer and would throw
            // away every snapshot since. Measured — a pushed document vanished the
            // first time anything called load() after the watch was open.
            read.add(path);
            return store.follow(path, () => onChange(store.view(path)), onError);
        };
    }

    return adapter;
}
