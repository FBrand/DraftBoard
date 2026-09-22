/**
 * Stores collections of documents in localStorage.
 *
 * The shape is deliberately the one a document store wants — a collection is a
 * map of id to document, and every operation names a single document — even
 * though localStorage can only rewrite a whole key. Writing the whole key is
 * this adapter's problem, not the caller's: the caller says "set this
 * document", and the Firestore adapter does exactly that with no change above
 * it.
 *
 * **One key per collection, and the key is the path.**
 *
 * That sounds obvious and took two wrong turns to arrive at. First the path was
 * flattened into the key by folding the slashes —
 * `db_seasons__s_1__charts__rosterState__rows` — which put a wall of
 * `__`-joined strings in front of anyone opening a storage inspector,
 * indistinguishable from the composite document keys the data model had just
 * got rid of. Then the hierarchy moved inside the value, one key per root
 * collection holding a tree. That removed the `__` and cost this, measured:
 *
 *     one draft pick   (rewrites db_players, 147KB)      36.8 ms
 *     one remark       (rewrites db_evaluations, 2.0MB)  557.8 ms
 *
 * Half a second to type a note, because one document write re-serialised every
 * evaluation in the season — roughly ten thousand times the bytes the write
 * actually changed.
 *
 * A localStorage key is an arbitrary string and may contain a slash. So the key
 * is `db_` plus the path: `db_seasons/s_1/charts/rosterState/rows`. It reads as
 * what it is, there is no `__` anywhere, and a write touches only the
 * collection that changed.
 */
import { prefixedId } from '../utils/ids';

const PREFIX = 'db_';

/**
 * Who the local store thinks you are.
 *
 * A constant, because there is nobody else here. localStorage is one browser
 * and one person; there is no sign-in to distinguish a second one and nothing
 * for an ownership check to protect against. Boards written here carry it as
 * their owner so the same code path works on both backends, and it simply
 * never means anything locally.
 */
const LOCAL_IDENTITY = 'local';

const keyFor = (collection) => `${PREFIX}${collection}`;

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
    // Throws rather than swallowing. A full quota or a private-mode window is
    // a write that did not happen, and the repository puts the local change
    // back and says so — which it cannot do if the failure is hidden here.
    localStorage.setItem(keyFor(collection), JSON.stringify(docs));
}

/** @type {import('./types').Adapter} */
export const localAdapter = {
    name: 'local',

    /**
     * WHO is acting, and WHAT a new author's id should be — both answered by
     * the adapter, because both are things only the backend knows.
     *
     * On Firebase an author IS the signed-in person: the record is keyed by
     * his uid, so `newAuthorId` hands back that uid and a rule can check
     * "is this author me" against the token without reading anything. Here
     * there is no auth and no uid, so an author is what it has always been —
     * a display label with a generated id, several of which can coexist
     * (Dan, Ryan, consensus). Keeping that decision behind the seam is what
     * lets boardRegistry create an author the same way on both backends.
     *
     * `taken` comes from the caller because uniqueness is checked against a
     * collection the caller already has loaded; the adapter decides the id's
     * SHAPE, not what is in the store.
     */
    identity() {
        return LOCAL_IDENTITY;
    },

    newAuthorId(taken) {
        return prefixedId('a', taken);
    },

    /**
     * Always. There is no shared store to be refused by and no second person
     * to be refused on behalf of — every write lands in this browser, which
     * is the whole local-only app.
     */
    isExpert() {
        return true;
    },

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
     * absence is what forces callers onto `ready()` rather than letting them
     * quietly read nothing.
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

    /** Like commit(), but items may span different collections. */
    async commitMany(items) {
        const byPath = new Map();
        items.forEach(({ path, id, doc }) => {
            if (!byPath.has(path)) byPath.set(path, readAll(path));
            const docs = byPath.get(path);
            if (doc === null) delete docs[id];
            else docs[id] = doc;
        });
        byPath.forEach((docs, path) => writeAll(path, docs));
    },

    async clear(collection) {
        try { localStorage.removeItem(keyFor(collection)); } catch { /* ignore */ }
    },
};

export { keyFor as collectionKey };
