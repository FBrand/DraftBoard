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
const PREFIX = 'db_';

const keyFor = (collection) => `${PREFIX}${collection}`;

/** Every key in storage, through the Storage interface's own API. */
function storageKeys() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (k) out.push(k);
        }
    } catch { /* unreadable */ }
    return out;
}

/**
 * Brings forward whatever an older build wrote, once.
 *
 * Two earlier layouts exist and both have to be found, because either one
 * being missed means the app comes up empty on first load — every board, every
 * roster, every evaluation apparently gone, when they are only at an address
 * nothing asks for.
 *
 *   1. Flattened path keys: `db_seasons__s_1__charts__rosterState__rows`.
 *      Split on `__`; safe because nothing in a path contains a double
 *      underscore — ids are a prefix plus a uuid or base36, stage names are
 *      single-underscored, kinds are one letter.
 *   2. A root tree: `db_seasons` holding `{ docs, sub }`, walked so each node's
 *      documents go to their own key.
 */
let migrated = false;

function migrateOnce() {
    if (migrated) return;
    migrated = true;

    const moves = [];

    storageKeys().forEach(key => {
        if (!key.startsWith(PREFIX)) return;
        const rest = key.slice(PREFIX.length);

        let value = null;
        try { value = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;

        // A root tree — nothing else carries `docs` or `sub` at the top.
        if (value.docs || value.sub) {
            const walk = (node, trail) => {
                if (node.docs && Object.keys(node.docs).length) {
                    moves.push({ path: [rest, ...trail].join('/'), docs: node.docs });
                }
                Object.entries(node.sub ?? {}).forEach(([step, child]) => walk(child, [...trail, step]));
            };
            walk(value, []);
            moves.push({ drop: key });
            return;
        }

        // A flattened path key.
        if (rest.includes('__')) {
            moves.push({ path: rest.split('__').filter(Boolean).join('/'), docs: value });
            moves.push({ drop: key });
        }
    });

    if (!moves.length) return;
    try {
        // Drops first, writes after. A root tree's own documents land at the
        // root's own path — `db_seasons` holds both the old tree and the new
        // `seasons` collection — so writing before dropping deleted exactly
        // what had just been written.
        moves.filter(m => m.drop).forEach(m => localStorage.removeItem(m.drop));
        moves.filter(m => m.path).forEach(m => {
            const target = keyFor(m.path);
            let existing = {};
            try { existing = JSON.parse(localStorage.getItem(target) ?? '{}') ?? {}; } catch { existing = {}; }
            localStorage.setItem(target, JSON.stringify({ ...existing, ...m.docs }));
        });
    } catch { /* a full quota leaves the old keys in place; nothing is lost */ }
}

function readAll(collection) {
    migrateOnce();
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

    async clear(collection) {
        try { localStorage.removeItem(keyFor(collection)); } catch { /* ignore */ }
    },
};

/** Lets a test — or a clean slate — forget that the migration already ran. */
export function resetLegacyFold() {
    migrated = false;
}

export { keyFor as collectionKey };
