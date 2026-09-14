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
 * **localStorage is flat and the data is not.** A collection is a path —
 * `seasons/s_1/charts/rosterState/rows` — and this used to flatten it into one
 * key by folding the slashes: `db_seasons__s_1__charts__rosterState__rows`.
 * That worked, and it meant a storage inspector showed a wall of `__`-joined
 * strings indistinguishable from the composite keys the data model had just
 * got rid of.
 *
 * So the hierarchy is kept INSIDE the value instead. One key per root
 * collection — `db_seasons`, `db_players`, `db_evaluations` — holding a tree.
 * Each node keeps its own documents and its subcollections apart, because a
 * season is both a document in `seasons` and the parent of
 * `seasons/{id}/charts`:
 *
 *     db_seasons = {
 *       docs: { s_1: {…the season…} },
 *       sub:  { s_1: { charts: { sub: { rosterState: { sub: {
 *                 rows: { docs: { "O-WR.Z-0": {…} } } } } } } } }
 *     }
 *
 * The cost is real and worth naming: a write now rewrites its whole ROOT blob
 * rather than one collection's. Writing one remark rewrites every evaluation.
 * The old layout wrote less; it also could not be looked at without seeing
 * exactly the thing that was supposed to be gone.
 */
const PREFIX = 'db_';

/** `seasons/s_1/charts` → `{ root: 'seasons', trail: ['s_1', 'charts'] }` */
function split(collection) {
    const parts = String(collection ?? '').split('/').filter(Boolean);
    return { root: parts[0] ?? '', trail: parts.slice(1) };
}

const keyFor = (collection) => `${PREFIX}${split(collection).root}`;

/**
 * Folds keys written by the flattened build into the tree, once per root.
 *
 * Everything an existing user has is under `db_seasons__s_1__charts__…`. The
 * new reader never looks there, so without this the first load of the new
 * build shows an empty app — every board, every roster, every evaluation
 * apparently gone. They are not gone; they are at an address nothing asks for.
 *
 * Splitting the old key on `__` is safe because nothing that appears in a path
 * contains a double underscore: ids are `p_`/`b_`/`s_` plus a uuid or base36,
 * stage names are single-underscored (`fa_state_v1`), kinds are one letter.
 */
const folded = new Set();

function foldLegacy(root) {
    if (folded.has(root)) return null;
    folded.add(root);

    // Enumerated through length/key(i), the Storage interface's own API.
    // Object.keys() happens to work on a browser's localStorage, because it
    // exposes its entries as own properties — and on anything implementing the
    // interface without that quirk it returns the object's fields instead,
    // which is silently nothing to fold.
    const keys = [];
    try {
        const prefix = `${PREFIX}${root}__`;
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
        }
    } catch { return null; }
    if (!keys.length) return null;

    let tree = {};
    try {
        const existing = localStorage.getItem(`${PREFIX}${root}`);
        if (existing) tree = JSON.parse(existing) ?? {};
    } catch { tree = {}; }

    keys.forEach(key => {
        let docs = null;
        try { docs = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { docs = null; }
        if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return;
        const trail = key.slice(PREFIX.length + root.length + 2).split('__').filter(Boolean);
        const node = nodeAt(tree, trail, { create: true });
        node.docs = { ...(node.docs ?? {}), ...docs };
    });

    try {
        localStorage.setItem(`${PREFIX}${root}`, JSON.stringify(tree));
        keys.forEach(k => localStorage.removeItem(k));
    } catch { /* a full quota leaves the old keys; nothing is lost */ }
    return tree;
}

function readRoot(collection) {
    const { root } = split(collection);
    const moved = foldLegacy(root);
    if (moved) return moved;

    try {
        const raw = localStorage.getItem(keyFor(collection));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeRoot(collection, tree) {
    // Throws rather than swallowing. A full quota or a private-mode window is
    // a write that did not happen, and the repository puts the local change
    // back and says so — which it cannot do if the failure is hidden here.
    localStorage.setItem(keyFor(collection), JSON.stringify(tree));
}

/**
 * Walks to the node a path names.
 *
 * The trail alternates document id and subcollection name, which is what a
 * path means: `s_1/charts` is the `charts` collection under the document
 * `s_1`. So the walk steps through `sub` by document id, then by collection
 * name, and the node it lands on is the one holding that collection's `docs`.
 */
function nodeAt(tree, trail, { create = false } = {}) {
    let node = tree;
    for (let i = 0; i < trail.length; i += 1) {
        if (!node.sub) {
            if (!create) return null;
            node.sub = {};
        }
        const step = trail[i];
        if (!node.sub[step]) {
            if (!create) return null;
            node.sub[step] = {};
        }
        node = node.sub[step];
    }
    return node;
}

function readAll(collection) {
    const { trail } = split(collection);
    const node = nodeAt(readRoot(collection), trail);
    const docs = node?.docs;
    return docs && typeof docs === 'object' && !Array.isArray(docs) ? docs : {};
}

/** Applies a change to the collection's documents and writes the root back. */
function update(collection, mutate) {
    const { trail } = split(collection);
    const tree = readRoot(collection);
    const node = nodeAt(tree, trail, { create: true });
    node.docs = { ...(node.docs ?? {}) };
    mutate(node.docs);
    if (!Object.keys(node.docs).length) delete node.docs;
    writeRoot(collection, tree);
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
        update(collection, docs => { docs[id] = doc; });
    },

    async remove(collection, id) {
        update(collection, docs => { delete docs[id]; });
    },

    /** Several documents at once, so a batch is one write rather than N. */
    async commit(collection, changes) {
        update(collection, docs => {
            changes.forEach(({ id, doc }) => {
                if (doc === null) delete docs[id];
                else docs[id] = doc;
            });
        });
    },

    /**
     * Drops one collection's documents, leaving anything nested under it.
     *
     * A root collection with nothing left — no documents and no
     * subcollections — takes its key with it, so clearing really does clear
     * rather than leaving an empty husk behind for the next inspector.
     */
    async clear(collection) {
        try {
            const { trail } = split(collection);
            const tree = readRoot(collection);
            const node = nodeAt(tree, trail);
            if (!node) return;
            delete node.docs;
            if (!Object.keys(tree.docs ?? {}).length && !Object.keys(tree.sub ?? {}).length) {
                localStorage.removeItem(keyFor(collection));
                return;
            }
            writeRoot(collection, tree);
        } catch { /* ignore */ }
    },
};

/** Lets a test — or a clean slate — forget that a root was already folded. */
export function resetLegacyFold() {
    folded.clear();
}

export { keyFor as collectionKey };
