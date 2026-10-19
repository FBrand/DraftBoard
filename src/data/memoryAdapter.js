/**
 * A store that keeps everything in a Map and nothing anywhere else.
 *
 * Its job is to be the SECOND adapter. Until something other than
 * localStorage implements the interface, "the backend is swappable" is a claim
 * rather than a fact, and the first time it gets tested is the first time it
 * matters — against a real service, with auth and rules and a network all able
 * to explain a failure that is really none of them.
 *
 * So it is deliberately awkward in the one way a remote store is awkward:
 *
 *   **It does not implement `loadSync`.** That is the whole point. Every
 *   synchronous read in the app is served by localStorage's ability to answer
 *   instantly, and no network can. Running against this adapter is how those
 *   reads reveal themselves — as an empty board rather than a crash, which is
 *   why they need finding on purpose.
 *
 * It is also useful on its own: a test can have a repository that starts empty
 * and leaves nothing behind.
 */
export function createMemoryAdapter({ latency = 0, failWrites = false } = {}) {
    const store = new Map();

    const wait = () => (latency > 0
        ? new Promise(resolve => setTimeout(resolve, latency))
        : Promise.resolve());

    const read = (collection) => ({ ...(store.get(collection) ?? {}) });

    const write = async (collection, docs) => {
        await wait();
        if (failWrites) throw new Error('memory adapter: writes disabled');
        store.set(collection, docs);
    };

    return {
        name: 'memory',

        // No loadSync. See the note above — its absence is the feature.

        async load(collection) {
            await wait();
            return read(collection);
        },

        async set(collection, id, doc) {
            await write(collection, { ...read(collection), [id]: doc });
        },

        async remove(collection, id) {
            const docs = read(collection);
            delete docs[id];
            await write(collection, docs);
        },

        async commit(collection, changes) {
            const docs = read(collection);
            changes.forEach(({ id, doc }) => {
                if (doc === null) delete docs[id];
                else docs[id] = doc;
            });
            await write(collection, docs);
        },

        async clear(collection) {
            await wait();
            store.delete(collection);
        },

        /** Test affordance: what the store actually holds. */
        dump() {
            return Object.fromEntries([...store.entries()].map(([k, v]) => [k, { ...v }]));
        },
    };
}
