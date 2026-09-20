/**
 * The repository's store, backed by Firestore.
 *
 * The interface is deliberately the one `localAdapter` and `memoryAdapter`
 * already implement — see `types.js` — so nothing above this file changes.
 * What is worth saying is where Firestore is NOT like localStorage, because
 * each of those is somewhere the app can break.
 *
 * **No `loadSync`.** The single most important line in the file is the one
 * that is not here. Every synchronous read in the app is served by
 * localStorage's ability to answer instantly, and no network can. Its absence
 * is what forces callers onto `ready()` instead of silently reading an empty
 * collection — see the note in `memoryAdapter.js`, which exists to make that
 * failure appear on purpose rather than in production.
 *
 * **A collection is a path, not a key.** `boards/b1/entries` is three
 * segments, and Firestore reads it as collection / document / collection.
 * That is the point of the paths — see `docs/STORAGE.md` — and it is why a
 * rule can be written about one board. Paths with an even number of segments
 * are documents, not collections, and are rejected here rather than at the
 * SDK, which reports them as a type error some frames away.
 *
 * **A batch has a limit.** Firestore commits at most 500 writes at once, and
 * the app routinely exceeds it: seeding a board is 328 documents, seeding the
 * registry is 733. So `commit` chunks. The chunks are not atomic with each
 * other, which is honest — a half-written seed is recoverable because seeding
 * is idempotent, and the alternative is refusing to seed at all.
 *
 * **A document id is not stored in the document.** Same rule as everywhere
 * else in this app, and Firestore agrees: the id lives on the reference, not
 * in the fields, and does not count against the 1MB document limit.
 */
import { connect } from './firebaseApp';

/** Firestore alternates collection/document, so a collection has odd segments. */
export function isCollectionPath(path) {
    const segments = String(path ?? '').split('/').filter(Boolean);
    return segments.length > 0 && segments.length % 2 === 1;
}

/** Firestore's hard limit on one batched write. */
export const BATCH_LIMIT = 500;

export function chunk(items, size = BATCH_LIMIT) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function assertCollection(path) {
    if (!isCollectionPath(path)) {
        throw new Error(
            `"${path}" is not a collection path. Firestore alternates collection and document, `
            + 'so a collection has an odd number of segments — "boards/b1/entries", not "boards/b1".',
        );
    }
}

export function createFirebaseAdapter() {
    // Imported once, on the first call, and reused. The SDK is a large
    // dependency and a build that never talks to Firebase should never pay
    // for it.
    let sdk = null;
    async function api() {
        if (sdk) return sdk;
        const [{ firestore }, fs] = await Promise.all([connect(), import('firebase/firestore')]);
        sdk = { db: firestore, ...fs };
        return sdk;
    }

    return {
        name: 'firebase',

        // No loadSync, and that is the feature. See the header.

        async load(path) {
            assertCollection(path);
            const { db, collection, getDocs } = await api();
            const snap = await getDocs(collection(db, path));
            const docs = {};
            snap.forEach(d => { docs[d.id] = d.data(); });
            return docs;
        },

        /**
         * Stays open, and reports the collection again whenever it changes.
         *
         * This is the difference between reading a board and FOLLOWING one. A
         * viewer who has to reload to see a pick is not watching a draft, and
         * the whole reason the shared store exists is that ten thousand people
         * should see Dan move a player the moment he moves him.
         *
         * Returns an unsubscribe. The first callback arrives with the current
         * contents, which makes it a load as well as a subscription — but the
         * repository still loads first, because a caller awaiting ready() needs
         * an answer even if the connection never opens.
         *
         * @param {string} path
         * @param {(docs: object) => void} onDocs
         * @param {(err: Error) => void} [onError]
         * @returns {() => void}
         */
        watch(path, onDocs, onError) {
            assertCollection(path);
            let stop = null;
            let cancelled = false;
            (async () => {
                try {
                    const { db, collection, onSnapshot } = await api();
                    if (cancelled) return;
                    stop = onSnapshot(
                        collection(db, path),
                        (snap) => {
                            const docs = {};
                            snap.forEach(d => { docs[d.id] = d.data(); });
                            onDocs(docs);
                        },
                        // A listener that dies takes live updates with it and
                        // says nothing. The collection keeps whatever it last
                        // held, which is right — stale beats blank — but
                        // somebody has to be told it stopped being live.
                        (err) => onError?.(err),
                    );
                } catch (err) {
                    onError?.(err);
                }
            })();
            return () => { cancelled = true; stop?.(); stop = null; };
        },

        async set(path, id, doc) {
            assertCollection(path);
            const { db, doc: docRef, setDoc } = await api();
            // Behind a flag, and only because what this promise DOES during an
            // outage is the whole open question: the docs say it does not
            // resolve until the server acknowledges, and what was observed
            // here looked like it resolved anyway. Left in so the next person
            // can see it rather than infer it.
            if (globalThis.__DB_TRACE) {
                const t0 = Date.now();
                console.log(`[trace] setDoc issued ${path}/${id}`);
                try {
                    await setDoc(docRef(db, path, id), doc);
                    console.log(`[trace] setDoc RESOLVED ${path}/${id} after ${Date.now() - t0}ms`);
                } catch (e) {
                    console.log(`[trace] setDoc REJECTED ${path}/${id} after ${Date.now() - t0}ms: ${e?.code ?? e?.message}`);
                    throw e;
                }
                return;
            }
            await setDoc(docRef(db, path, id), doc);
        },

        async remove(path, id) {
            assertCollection(path);
            const { db, doc: docRef, deleteDoc } = await api();
            await deleteDoc(docRef(db, path, id));
        },

        /**
         * A batch per 500 changes. `doc: null` is a deletion — the distinction
         * the whole commit path depends on, and not the same as a document
         * whose fields happen to be empty.
         */
        async commit(path, changes) {
            if (globalThis.__DB_TRACE) {
                const t0 = Date.now();
                const n = changes?.length ?? 0;
                console.log(`[trace] batch issued ${path} x${n}`);
                try {
                    const out = await this.commitInner(path, changes);
                    console.log(`[trace] batch RESOLVED ${path} x${n} after ${Date.now() - t0}ms`);
                    return out;
                } catch (e) {
                    console.log(`[trace] batch REJECTED ${path} x${n} after ${Date.now() - t0}ms: ${e?.code ?? e?.message}`);
                    throw e;
                }
            }
            return this.commitInner(path, changes);
        },

        async commitInner(path, changes) {
            assertCollection(path);
            if (!changes?.length) return;
            const { db, doc: docRef, writeBatch } = await api();

            for (const group of chunk(changes)) {
                const batch = writeBatch(db);
                group.forEach(({ id, doc }) => {
                    const ref = docRef(db, path, id);
                    if (doc === null) batch.delete(ref);
                    else batch.set(ref, doc);
                });
                await batch.commit();
            }
        },

        /**
         * Like commit(), but items span DIFFERENT collections and still land
         * in one writeBatch() together — Firestore's batch was never limited
         * to one collection, only this file's own commit(path, changes) shape
         * was. Needed wherever two documents in different collections must
         * land together or not at all (claiming a board also claims its
         * author record, and two independent commits can interleave and split
         * ownership between them — see boardRegistry.js claimBoard()).
         * Chunked the same way and for the same reason as commit(): a group
         * over 500 stops being one atomic write regardless of which
         * collections it touches, which is a Firestore limit, not a choice.
         */
        async commitMany(items) {
            if (!items?.length) return;
            items.forEach(({ path }) => assertCollection(path));
            const { db, doc: docRef, writeBatch } = await api();

            for (const group of chunk(items)) {
                const batch = writeBatch(db);
                group.forEach(({ path, id, doc }) => {
                    const ref = docRef(db, path, id);
                    if (doc === null) batch.delete(ref);
                    else batch.set(ref, doc);
                });
                await batch.commit();
            }
        },

        /**
         * Firestore has no "delete this collection" — that is a server-side
         * operation, because a collection does not exist apart from its
         * documents. So it is a read and then a batched delete, which is what
         * the console does too.
         */
        async clear(path) {
            assertCollection(path);
            const { db, collection, getDocs } = await api();
            const snap = await getDocs(collection(db, path));
            const ids = [];
            snap.forEach(d => ids.push(d.id));
            await this.commit(path, ids.map(id => ({ id, doc: null })));
        },
    };
}
