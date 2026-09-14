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
import { createAdapter } from './backend';

/**
 * @param {import('./types').Adapter} adapter
 */
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

    /**
     * Whether this collection can be read synchronously yet.
     *
     * "Nothing here" and "not loaded yet" are the same empty array to every
     * caller, and against a local adapter they always will be — loadSync fills
     * the cache on the spot. Against a remote one they are different answers
     * to different questions, and a caller that cannot tell them apart reports
     * the wrong one: the add form would show "no matching players" while the
     * registry was still arriving, and let somebody add a duplicate of a player
     * it simply had not seen yet.
     */
    function isLoaded(collection) {
        return cache.has(collection) || !!adapter.loadSync;
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

    // ── Writes that can fail, and are not thrown away ─────────────────────
    //
    // A write updates memory first, notifies, and reaches the store after —
    // right for a UI that must not wait, and a lie if the store then refuses.
    //
    // The first version of this put the local change BACK when a write failed.
    // That is honest about storage and terrible for the person: the work is
    // gone, and the only notice is a message saying so. Against localStorage
    // it barely mattered — a full quota is the only way to fail. Over a
    // network, offline is Tuesday.
    //
    // So a refused write is KEPT. The change stays in memory and on screen,
    // goes into a queue, and is retried with a widening gap. What is on screen
    // is the truth about what you did; the sync state is the truth about
    // whether anybody else can see it yet, and those are two different facts
    // that deserve two different places to live.
    //
    // Only when the queue gives up does the app admit defeat — and then it
    // says so loudly and offers the work as a file, because a session export
    // is the one escape hatch that does not need the backend to be working.
    const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

    const pending = new Map();      // key -> { collection, id, doc, op, attempts }
    const syncListeners = new Set();
    const writeErrorListeners = new Set();
    let retryTimer = null;
    let lastError = null;
    let gaveUp = false;
    let inFlight = 0;

    const keyOf = (collection, id) => `${collection}\u0000${id}`;

    /** What the UI shows: are we saved, saving, behind, or beaten. */
    function syncState() {
        if (gaveUp) return { state: 'failed', pending: pending.size, error: lastError };
        if (pending.size) return { state: 'retrying', pending: pending.size, error: lastError };
        if (inFlight) return { state: 'saving', pending: 0, error: null };
        return { state: 'saved', pending: 0, error: null };
    }

    function announce() {
        const snapshot = syncState();
        syncListeners.forEach(fn => {
            try { fn(snapshot); } catch { /* a listener must not break a write */ }
        });
    }

    /** Called whenever the sync state changes. Returns an unsubscribe. */
    function onSyncChange(fn) {
        syncListeners.add(fn);
        try { fn(syncState()); } catch { /* ignore */ }
        return () => syncListeners.delete(fn);
    }

    /** Notified when a write did not reach the store. Returns an unsubscribe. */
    function onWriteError(fn) {
        writeErrorListeners.add(fn);
        return () => writeErrorListeners.delete(fn);
    }

    function reportWriteError(detail) {
        writeErrorListeners.forEach(fn => {
            try { fn(detail); } catch { /* a listener must not break the queue */ }
        });
    }

    /**
     * Parks a write to try again.
     *
     * Keyed by document, so a player dragged five times while offline is one
     * pending write holding the latest position rather than five holding a
     * history nobody asked for. The attempt count follows the DOCUMENT, so a
     * document that keeps failing still runs out of patience.
     */
    function enqueue({ collection, id, doc, op }) {
        const key = keyOf(collection, id);
        const attempts = pending.get(key)?.attempts ?? 0;
        pending.set(key, { collection, id, doc, op, attempts });
        scheduleRetry();
        announce();
    }

    function scheduleRetry() {
        if (retryTimer || !pending.size || gaveUp) return;
        const worst = Math.min(...[...pending.values()].map(w => w.attempts));
        const wait = BACKOFF_MS[Math.min(worst, BACKOFF_MS.length - 1)];
        retryTimer = setTimeout(() => { retryTimer = null; flush(); }, wait);
    }

    /** Tries everything parked. Called on a timer, and by hand from the UI. */
    async function flush() {
        if (!pending.size) return;
        gaveUp = false;
        const batch = [...pending.values()];

        for (const write of batch) {
            const key = keyOf(write.collection, write.id);
            try {
                await (write.doc === null
                    ? adapter.remove(write.collection, write.id)
                    : adapter.set(write.collection, write.id, write.doc));
                pending.delete(key);
                lastError = null;
            } catch (err) {
                lastError = err?.message ?? String(err);
                const attempts = write.attempts + 1;
                pending.set(key, { ...write, attempts });
                // Out of patience. The change is still here and still on
                // screen — what stops is the pretending that it will land.
                if (attempts >= BACKOFF_MS.length) gaveUp = true;
            }
        }

        announce();
        if (pending.size && !gaveUp) scheduleRetry();
        if (gaveUp) {
            reportWriteError({
                collection: batch[0]?.collection ?? null,
                pending: pending.size,
                error: new Error(lastError ?? 'write refused'),
            });
        }
    }

    /** Try again now, from a button. */
    function retryNow() {
        gaveUp = false;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        announce();
        return flush();
    }

    /**
     * Runs a write, and parks it rather than losing it when it is refused.
     *
     * The local change is NOT put back. That is the whole point: the screen
     * keeps what you did, and the queue keeps trying to make it true.
     */
    function attempt(collection, id, doc, op, run) {
        inFlight += 1;
        announce();
        return Promise.resolve(run())
            .then(() => { lastError = null; })
            .catch(err => {
                lastError = err?.message ?? String(err);
                enqueue({ collection, id, doc, op });
                reportWriteError({ collection, id, op, error: err });
            })
            .finally(() => { inFlight = Math.max(0, inFlight - 1); announce(); });
    }

    function set(collection, id, doc) {
        applyLocal(collection, id, doc);
        return attempt(collection, id, doc, 'set', () => adapter.set(collection, id, doc));
    }

    function update(collection, id, patch) {
        const merged = { ...(get(collection, id) ?? {}), ...patch };
        return set(collection, id, merged);
    }

    function remove(collection, id) {
        applyLocal(collection, id, null);
        return attempt(collection, id, null, 'remove', () => adapter.remove(collection, id));
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

        const write = adapter.commit
            ? adapter.commit(collection, changes)
            : Promise.all(changes.map(c => (c.doc === null
                ? adapter.remove(collection, c.id)
                : adapter.set(collection, c.id, c.doc))));

        inFlight += 1;
        announce();
        return Promise.resolve(write)
            .then(() => { lastError = null; })
            .catch(err => {
                lastError = err?.message ?? String(err);
                // A batch that failed becomes individual pending writes: the
                // store may take some of them, and one poisoned document
                // should not hold the rest hostage for ever.
                changes.forEach(c => enqueue({ collection, id: c.id, doc: c.doc, op: c.doc === null ? 'remove' : 'set' }));
                reportWriteError({ collection, id: null, op: 'commit', error: err });
            })
            .finally(() => { inFlight = Math.max(0, inFlight - 1); announce(); });
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

    return {
        ready, ensureLoaded, docs, isLoaded, get, all, query,
        set, update, remove, commit, clear, subscribe, invalidate,
        onWriteError, onSyncChange, syncState, retryNow, adapter,
    };
}

// The app's one repository, pointed at whatever VITE_BACKEND names. Chosen
// here rather than passed down, because every store imports this directly and
// threading an adapter through all of them would be a change to each of them
// for a decision none of them make.
export const repository = createRepository(createAdapter());
