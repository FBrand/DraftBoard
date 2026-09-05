/**
 * One way in and out of stored data, so the store underneath can change
 * without the app noticing.
 *
 * The interface is Firestore's, narrowed to what this app does: documents in
 * named collections, addressed by id, with where/orderBy/limit over them.
 * Swapping localStorage for Firestore should be a change of adapter.
 *
 * ## Reads are synchronous, writes are not
 *
 * This is the part that matters, and it is not a compromise — it is how a
 * client with a live document store actually behaves. You subscribe to a
 * collection once, keep a local copy, and render from that copy; you do not
 * await a read to draw a frame. So the repository loads a collection
 * asynchronously and then serves reads from memory, synchronously.
 *
 * That keeps components able to render in one pass — a board ranks 328 players
 * on every keystroke and cannot await anything — while writes go through the
 * adapter and may take as long as a network does. Writes update memory first
 * and notify subscribers, so the UI moves at once and the store catches up.
 *
 * The honest limitation: a failed write has already been shown as succeeded.
 * With localStorage that only happens on a full quota. With a network it will
 * happen for real, and this is where the rollback goes.
 */
import { localAdapter } from './localAdapter';

export function createRepository(adapter = localAdapter) {
    const cache = new Map();       // collection -> { [id]: doc }
    const loading = new Map();     // collection -> Promise
    const listeners = new Map();   // collection -> Set<fn>

    const notify = (collection) => {
        listeners.get(collection)?.forEach(fn => {
            try { fn(cache.get(collection)); } catch { /* a listener must not break a write */ }
        });
    };

    /** Loads a collection into memory once. Returns a promise for the caller. */
    function ready(collection) {
        if (cache.has(collection)) return Promise.resolve(cache.get(collection));
        if (loading.has(collection)) return loading.get(collection);

        const promise = adapter.load(collection).then(docs => {
            cache.set(collection, docs ?? {});
            loading.delete(collection);
            notify(collection);
            return cache.get(collection);
        });
        loading.set(collection, promise);
        return promise;
    }

    /**
     * Fills a collection a synchronous read has reached before `ready()`
     * finished — only possible against an adapter that can read synchronously,
     * which is to say a local one. Returns null when it can't, and then a
     * synchronous read honestly reports nothing.
     */
    function ensureLoaded(collection) {
        const hit = cache.get(collection);
        if (hit) return hit;
        if (!adapter.loadSync) return null;
        const docsNow = adapter.loadSync(collection) ?? {};
        cache.set(collection, docsNow);
        return docsNow;
    }

    /** Synchronous read. Null until the collection has loaded. */
    function docs(collection) {
        return ensureLoaded(collection);
    }

    function get(collection, id) {
        return ensureLoaded(collection)?.[id] ?? null;
    }

    function all(collection) {
        return Object.values(ensureLoaded(collection) ?? {});
    }

    const OPS = {
        '==': (a, b) => a === b,
        '!=': (a, b) => a !== b,
        '<': (a, b) => a < b,
        '<=': (a, b) => a <= b,
        '>': (a, b) => a > b,
        '>=': (a, b) => a >= b,
        'in': (a, b) => Array.isArray(b) && b.includes(a),
        'array-contains': (a, b) => Array.isArray(a) && a.includes(b),
    };

    /**
     * where / orderBy / limit over the in-memory copy. Same call shape a
     * Firestore query takes, so the call sites don't change when the work
     * moves server-side — there it becomes an indexed query instead of a scan.
     */
    function query(collection, { where = [], orderBy = null, limit = null } = {}) {
        let rows = all(collection);

        where.forEach(([field, op, value]) => {
            const test = OPS[op];
            if (!test) throw new Error(`Unsupported query operator: ${op}`);
            rows = rows.filter(row => test(row?.[field], value));
        });

        if (orderBy) {
            const { field, direction = 'asc' } = orderBy;
            const sign = direction === 'desc' ? -1 : 1;
            rows = [...rows].sort((a, b) => {
                const x = a?.[field];
                const y = b?.[field];
                // Missing values sort last whichever way the sort runs: "not
                // recorded" is not a small value, it is no value.
                if (x == null && y == null) return 0;
                if (x == null) return 1;
                if (y == null) return -1;
                return (x < y ? -1 : x > y ? 1 : 0) * sign;
            });
        }

        return limit == null ? rows : rows.slice(0, limit);
    }

    function applyLocal(collection, id, doc) {
        const current = cache.get(collection) ?? {};
        const next = { ...current };
        if (doc === null) delete next[id];
        else next[id] = doc;
        cache.set(collection, next);
        notify(collection);
    }

    function set(collection, id, doc) {
        applyLocal(collection, id, doc);
        return adapter.set(collection, id, doc);
    }

    function update(collection, id, patch) {
        const merged = { ...(get(collection, id) ?? {}), ...patch };
        return set(collection, id, merged);
    }

    function remove(collection, id) {
        applyLocal(collection, id, null);
        return adapter.remove(collection, id);
    }

    /** Several documents in one go — one adapter round trip, one notify. */
    function commit(collection, changes) {
        const current = cache.get(collection) ?? {};
        const next = { ...current };
        changes.forEach(({ id, doc }) => {
            if (doc === null) delete next[id];
            else next[id] = doc;
        });
        cache.set(collection, next);
        notify(collection);
        return adapter.commit
            ? adapter.commit(collection, changes)
            : Promise.all(changes.map(c => (c.doc === null
                ? adapter.remove(collection, c.id)
                : adapter.set(collection, c.id, c.doc))));
    }

    function clear(collection) {
        cache.delete(collection);
        loading.delete(collection);
        notify(collection);
        return adapter.clear ? adapter.clear(collection) : Promise.resolve();
    }

    /** Called on every change to the collection, and once it first loads. */
    function subscribe(collection, fn) {
        if (!listeners.has(collection)) listeners.set(collection, new Set());
        listeners.get(collection).add(fn);
        return () => listeners.get(collection)?.delete(fn);
    }

    /** Drops the in-memory copy so the next `ready` re-reads. For a wipe. */
    function invalidate(collection) {
        if (collection == null) { cache.clear(); loading.clear(); }
        else { cache.delete(collection); loading.delete(collection); }
    }

    return { ready, ensureLoaded, docs, get, all, query, set, update, remove, commit, clear, subscribe, invalidate, adapter };
}

export const repository = createRepository();
