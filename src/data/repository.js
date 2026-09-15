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
import { classifyWriteError } from './writeErrors';

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

    /**
     * Whatever the store returned, with anything still queued laid on top.
     * A pending write is by definition newer than the store's answer.
     */
    function withPending(collection, docs) {
        const merged = { ...(docs ?? {}) };
        const lay = (w) => {
            if (w.collection !== collection) return;
            if (w.doc === null) delete merged[w.id];
            else merged[w.id] = w.doc;
        };
        sending.forEach(lay);   // sent, not acknowledged
        pending.forEach(lay);   // refused, waiting to be retried
        return merged;
    }

    /**
     * Collections the STORE has answered for.
     *
     * Deliberately not `cache.has()`. A write primes the cache for a collection
     * that may never have loaded — `applyLocal` and `commit` both have to, so
     * the change shows at once — and `ready()` reading `cache.has()` took that
     * one document as the whole collection and skipped the store for good.
     *
     * Against a local adapter that is invisible: the write went to the same
     * place the read would have come from. Against a remote one a viewer opened
     * the app, something wrote a single document before the season had arrived,
     * and `openBoards()` awaited a `ready()` that resolved instantly on an
     * empty collection — so it concluded nobody had ever made a board and
     * seeded a private season over the top of the expert's. 6 boots out of 6.
     *
     * `restoreQueue` documents the same trap and guards it by hand; this is
     * that guard made general.
     */
    const loaded = new Set();

    /**
     * Collections being kept up to date by the store, and how to stop.
     *
     * Only a store that can push has any — localStorage cannot change behind
     * the app's back, so nothing is listened to and no watcher is started.
     */
    const watchers = new Map();

    /** How many callers are following each collection. */
    const followers = new Map();

    /**
     * Writes sent to the store and not yet acknowledged.
     *
     * `pending` holds writes that FAILED and are waiting to be retried. That
     * was the whole story while the store only ever answered when asked: a
     * write in flight needed no protection, because nothing could overwrite
     * the cache underneath it.
     *
     * A store that pushes changes it. A snapshot can arrive in the gap
     * between showing somebody's drag and the server accepting it, carrying
     * the position the player was in before — so he would jump back across
     * the board, and then jump forward again a moment later when the write
     * landed. On a live broadcast that reads as the app losing the pick.
     */
    const sending = new Map();

    function startSending(collection, id, doc, op) {
        if (id == null) return () => {};
        const key = keyOf(collection, id);
        sending.set(key, { collection, id, doc, op });
        return () => sending.delete(key);
    }

    /** Loads a collection into memory once. Returns a promise for the caller. */
    function ready(collection) {
        if (loaded.has(collection)) return Promise.resolve(cache.get(collection));
        if (loading.has(collection)) return loading.get(collection);

        const promise = adapter.load(collection).then(docs => {
            // A read the store could not answer must not count as loaded, or a
            // transient failure would be cached for the life of the page and
            // never retried.
            if (!adapter.readFailed?.(collection)) loaded.add(collection);
            // Anything still queued is NEWER than anything the store can
            // return — that is what "not saved yet" means — so it goes on top.
            cache.set(collection, withPending(collection, docs));
            loading.delete(collection);
            notify(collection);
            return cache.get(collection);
        });
        loading.set(collection, promise);
        return promise;
    }

    /**
     * Keeps a collection up to date once it has loaded.
     *
     * The load still happens first and is still what ready() resolves on: a
     * caller awaiting it needs an answer even if the connection never opens,
     * and a first snapshot that never arrives would hang the app rather than
     * show it a stale board. This is the difference between reading the shared
     * record and following it — an expert moves a player and the people
     * watching see it, without being told to reload.
     *
     * A pending write still wins, same as on load. Somebody who has just
     * dragged a player must not watch him jump back because the store answered
     * a moment later with the version it held before.
     */
    /**
     * Follows a collection: subscribes to it AND keeps it up to date from the
     * store, for as long as somebody is listening.
     *
     * Opt-in, per collection, and counted — because a listener is not free.
     * Every collection the app touches was watched at first, which is twenty
     * open streams per viewer: on a real project that is twenty times the
     * reads, and against the emulator it was enough to fill the log with
     * NETWORK_ERROR and leave the client wedged offline, where writes queue
     * for ever and nothing says why. A board is worth following. The season
     * record and the player registry are read once and change almost never.
     *
     * @returns {() => void} stop listening; the last one out stops the watch
     */
    function follow(collection, fn) {
        const unsubscribe = subscribe(collection, fn);
        followers.set(collection, (followers.get(collection) ?? 0) + 1);
        startWatching(collection);
        let done = false;
        return () => {
            if (done) return;
            done = true;
            unsubscribe();
            const left = (followers.get(collection) ?? 1) - 1;
            if (left > 0) { followers.set(collection, left); return; }
            followers.delete(collection);
            stopWatching(collection);
        };
    }

    function startWatching(collection) {
        if (!adapter.watch || watchers.has(collection)) return;
        const stop = adapter.watch(
            collection,
            (docs) => {
                // Dropped rather than applied if the collection has since been
                // invalidated — a late snapshot would otherwise resurrect what
                // a wipe has just removed.
                if (!loaded.has(collection)) return;
                cache.set(collection, withPending(collection, docs));
                notify(collection);
            },
            (err) => reportWriteError({
                collection,
                id: null,
                op: 'watch',
                error: err,
                permanent: false,
                advice: 'Live updates stopped. What is on screen is the last the store sent.',
            }),
        );
        watchers.set(collection, stop);
    }

    function stopWatching(collection) {
        if (collection == null) {
            watchers.forEach(stop => { try { stop(); } catch { /* already gone */ } });
            watchers.clear();
            return;
        }
        const stop = watchers.get(collection);
        if (stop) { try { stop(); } catch { /* already gone */ } }
        watchers.delete(collection);
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
        // Same merge as `ready`, and for the same reason: a queued write is
        // newer than anything the store can return. This is the door the app
        // actually comes through — a synchronous read during render beats the
        // asynchronous load every time — so leaving the merge out of it meant
        // a reload with unsaved work showed the OLD value while the queue
        // wrote the new one behind it.
        const docsNow = withPending(collection, adapter.loadSync(collection) ?? {});
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

    /**
     * Whether the last load of this collection failed to reach the store.
     *
     * For callers that must not mistake "could not read" for "nothing there".
     * Always false against a store that cannot fail to be reached.
     */
    /**
     * Whether the store pushes changes, or only answers when asked.
     *
     * A view uses this to decide whether following is worth the subscription:
     * against localStorage nothing can change behind the app's back, so
     * re-reading on every notify would be work with no possible new answer.
     */
    function isLive() {
        return !!adapter.watch;
    }

    function loadFailed(collection) {
        return adapter.readFailed?.(collection) ?? false;
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

    // ── The queue outlives the tab ────────────────────────────────────────
    //
    // A queue in memory is a queue that a reload throws away, and a reload is
    // exactly what somebody does when the app seems stuck. So the pending
    // writes are written down — to localStorage, which is emphatically NOT
    // the store they failed to reach, and is therefore still available when
    // that store is not.
    //
    // This is the difference between "your change is being retried" and "your
    // change was being retried". Without it the promise of not losing work
    // lasts until the next refresh, which is not a promise.
    const QUEUE_KEY = 'pending_writes_v1';

    function persistQueue() {
        try {
            if (!pending.size) { localStorage.removeItem(QUEUE_KEY); return; }
            localStorage.setItem(QUEUE_KEY, JSON.stringify([...pending.values()]));
        } catch { /* if even this fails, the in-memory queue is all there is */ }
    }

    function restoreQueue() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null'); } catch { saved = null; }
        if (!Array.isArray(saved) || !saved.length) return;

        saved.forEach(w => {
            if (!w?.collection || !w?.id) return;
            pending.set(keyOf(w.collection, w.id), { ...w, attempts: 0 });
        });

        // Deliberately NOT applied to the cache here. Putting them in would
        // make `cache.has(collection)` true, and `ready()` takes that as "this
        // collection is loaded" and skips the store entirely — a restored
        // queue of two rows became the whole depth chart, and a reload with an
        // unsaved change dropped 84 of 91 players. They are merged on top when
        // the collection actually loads; see `ready`.
        scheduleRetry();
        announce();
    }
    const syncListeners = new Set();
    const writeErrorListeners = new Set();
    let retryTimer = null;
    let lastError = null;
    let lastAdvice = null;
    let gaveUp = false;
    let inFlight = 0;

    const keyOf = (collection, id) => `${collection}\u0000${id}`;

    /** What the UI shows: are we saved, saving, behind, or beaten. */
    function syncState() {
        if (gaveUp) return { state: 'failed', pending: pending.size, error: lastError, advice: lastAdvice };
        if (pending.size) return { state: 'retrying', pending: pending.size, error: lastError, advice: lastAdvice };
        if (inFlight) return { state: 'saving', pending: 0, error: null, advice: null };
        return { state: 'saved', pending: 0, error: null, advice: null };
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
        persistQueue();
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
                persistQueue();
                lastError = null;
            } catch (err) {
                const verdict = classifyWriteError(err);
                lastError = err?.message ?? String(err);
                lastAdvice = verdict.advice;

                const attempts = verdict.permanent ? BACKOFF_MS.length : write.attempts + 1;
                pending.set(key, { ...write, attempts });
                persistQueue();

                // A store that has JUDGED the write and refused it will refuse
                // it again. Spending four more attempts on that buries the
                // reason under "retrying", which is the one word that tells
                // somebody to sit and wait.
                if (verdict.permanent || attempts >= BACKOFF_MS.length) gaveUp = true;
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
        lastAdvice = null;
        pending.forEach((w, k) => pending.set(k, { ...w, attempts: 0 }));
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
        const settled = startSending(collection, id, doc, op);
        announce();
        return Promise.resolve(run())
            .then(() => { lastError = null; })
            .catch(err => {
                const verdict = classifyWriteError(err);
                lastError = err?.message ?? String(err);
                lastAdvice = verdict.advice;
                enqueue({ collection, id, doc, op });
                if (verdict.permanent) {
                    pending.set(keyOf(collection, id), { collection, id, doc, op, attempts: BACKOFF_MS.length });
                    persistQueue();
                    gaveUp = true;
                }
                reportWriteError({ collection, id, op, error: err, permanent: verdict.permanent, advice: verdict.advice });
            })
            .finally(() => { settled(); inFlight = Math.max(0, inFlight - 1); announce(); });
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
        const settled = changes.map(c => startSending(
            collection, c.id, c.doc, c.doc === null ? 'remove' : 'set',
        ));
        announce();
        return Promise.resolve(write)
            .then(() => { lastError = null; })
            .catch(err => {
                const verdict = classifyWriteError(err);
                lastError = err?.message ?? String(err);
                lastAdvice = verdict.advice;
                // A batch that failed becomes individual pending writes: the
                // store may take some of them, and one poisoned document
                // should not hold the rest hostage for ever.
                changes.forEach(c => enqueue({
                    collection, id: c.id, doc: c.doc, op: c.doc === null ? 'remove' : 'set',
                }));
                if (verdict.permanent) { gaveUp = true; persistQueue(); }
                reportWriteError({ collection, id: null, op: 'commit', error: err, permanent: verdict.permanent, advice: verdict.advice });
            })
            .finally(() => { settled.forEach(done => done()); inFlight = Math.max(0, inFlight - 1); announce(); });
    }

    function clear(collection) {
        cache.delete(collection);
        loaded.delete(collection);
        loading.delete(collection);
        stopWatching(collection);
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
        stopWatching(collection);
        if (collection == null) { cache.clear(); loaded.clear(); loading.clear(); }
        else { cache.delete(collection); loaded.delete(collection); loading.delete(collection); }
    }

    // Anything left from a previous visit is picked up before anything else
    // happens, so a reload resumes rather than forgets.
    restoreQueue();

    return {
        ready, ensureLoaded, docs, isLoaded, loadFailed, isLive, follow, get, all, query,
        set, update, remove, commit, clear, subscribe, invalidate,
        onWriteError, onSyncChange, syncState, retryNow, adapter,
    };
}

// The app's one repository, pointed at whatever VITE_BACKEND names. Chosen
// here rather than passed down, because every store imports this directly and
// threading an adapter through all of them would be a change to each of them
// for a decision none of them make.
export const repository = createRepository(createAdapter());
