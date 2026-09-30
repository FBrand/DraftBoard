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
import { prefixedId } from '../utils/ids';

// Every adapter built, so a test can empty all of them without having to
// reach the one the repository happens to be holding.
//
// The unit suite runs on this adapter, and its isolation used to be "replace
// globalThis.localStorage" — which isolates nothing once the documents live in
// a Map in here. Reaching the instance through the repository would work and
// costs too much: importing the repository into the suite's setup file pulls
// backend.js and firebaseApp.js in with it, and the adapter test mocks
// firebase/firestore partially, so the real module being in the graph first
// broke six tests that had nothing to do with any of this. This module's only
// import is ids, which is why the registry lives here.
const built = new Set();
const dumps = new Set();

/** Empties every memory adapter. Tests only. */
export function resetMemoryAdapters() {
    built.forEach(reset => reset());
}

/**
 * Everything every memory adapter holds, merged. Tests only.
 *
 * For weighing SHAPES rather than a particular browser: the suite runs on this
 * adapter, so localStorage is empty and a budget measured against it reports
 * nothing at all. See utils/storageBudget.measureDump.
 */
export function dumpMemoryAdapters() {
    const out = {};
    dumps.forEach(dump => Object.assign(out, dump()));
    return out;
}

export function createMemoryAdapter({ latency = 0, failWrites = false } = {}) {
    const store = new Map();
    built.add(() => store.clear());
    dumps.add(() => Object.fromEntries([...store.entries()].map(([k, v]) => [k, { ...v }])));

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

        /**
         * Every collection this adapter holds.
         *
         * The seeder used to enumerate the REPOSITORY's collections, which are
         * only the ones the repository itself loaded. Evaluations are written
         * through the layered store (src/data/store.js) straight to the
         * adapter, so the repository never had them in its cache and every
         * example remark the seed produced was silently dropped on the way
         * out — 1768 documents uploaded, not one of them a remark, on every
         * run. The adapter is where everything actually lands, so it is what a
         * "give me all of it" caller has to ask.
         */
        collections() {
            return [...store.keys()];
        },

        // Same answers localAdapter gives, and for the same reason: no auth,
        // nobody else here. See its note for why the adapter is what decides
        // an author's id at all.
        identity() {
            return 'local';
        },

        newAuthorId(taken) {
            return prefixedId('a', taken);
        },

        isExpert() {
            return true;
        },

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

        /** Like commit(), but items may span different collections. */
        async commitMany(items) {
            const byPath = new Map();
            items.forEach(({ path, id, doc }) => {
                if (!byPath.has(path)) byPath.set(path, read(path));
                const docs = byPath.get(path);
                if (doc === null) delete docs[id];
                else docs[id] = doc;
            });
            for (const [path, docs] of byPath) await write(path, docs);
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
