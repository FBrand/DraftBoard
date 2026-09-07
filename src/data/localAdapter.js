/**
 * Stores collections of documents in localStorage.
 *
 * The shape is deliberately the one a document store wants — a collection is a
 * map of id to document, and every operation names a single document — even
 * though localStorage can only rewrite a whole key. Writing the whole key is
 * this adapter's problem, not the caller's: the caller says "set this
 * document", and a Firestore adapter will do exactly that with no change above
 * it.
 *
 * The alternative, keeping each store as one JSON blob and calling it a
 * document, would have looked the same locally and fallen apart on the first
 * real write — two analysts editing different players would overwrite each
 * other wholesale.
 */
const PREFIX = 'db_';

const keyFor = (collection) => `${PREFIX}${collection.replace(/\//g, '__')}`;

function readAll(collection) {
    try {
        const raw = localStorage.getItem(keyFor(collection));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeAll(collection, docs) {
    try {
        localStorage.setItem(keyFor(collection), JSON.stringify(docs));
    } catch { /* quota or private mode — the in-memory copy still stands */ }
}

export const localAdapter = {
    name: 'local',

    // Async by contract even though localStorage is synchronous, so callers
    // are written against the interface a network will have rather than the
    // one this happens to be.
    async load(collection) {
        return readAll(collection);
    },

    /**
     * The same read, synchronously — which only a local store can offer.
     *
     * The repository uses it to fill a collection that a synchronous read
     * reaches first, which happens on the roster import path: it resolves
     * players while parsing, and without this it would see an empty registry
     * and mint a second record for every one of them.
     *
     * A remote adapter will not have this method, and that is the point. Its
     * absence is what will force callers onto `ready()` rather than letting
     * them quietly read nothing.
     */
    loadSync(collection) {
        return readAll(collection);
    },

    async set(collection, id, doc) {
        const docs = readAll(collection);
        docs[id] = doc;
        writeAll(collection, docs);
    },

    async remove(collection, id) {
        const docs = readAll(collection);
        delete docs[id];
        writeAll(collection, docs);
    },

    /** Several documents at once, so a batch is one write rather than N. */
    async commit(collection, changes) {
        const docs = readAll(collection);
        changes.forEach(({ id, doc }) => {
            if (doc === null) delete docs[id];
            else docs[id] = doc;
        });
        writeAll(collection, docs);
    },

    async clear(collection) {
        try { localStorage.removeItem(keyFor(collection)); } catch { /* ignore */ }
    },
};

export { keyFor as collectionKey };
