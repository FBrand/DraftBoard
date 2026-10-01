/**
 * Layers with a stated order, instead of one cache everything was merged into.
 *
 * The repository keeps a single map per collection and merges the write queue
 * into it — in three places, destructively — so afterwards there is no way
 * back to what the store actually said. Every failure this month is a caller
 * that needed that distinction and had no way to ask: seeding read "are there
 * boards?" and its own REFUSED writes answered yes, so a project that held
 * nothing looked seeded, for weeks, on every screen.
 *
 * Here there are three layers and one order:
 *
 *     shared    what the backend said
 *     mine      this person's own work, where it is kept apart
 *     unsent    issued, not yet acknowledged
 *
 * `view()` merges them in that order. `shared()` hands back the backend's
 * answer untouched. A caller that RENDERS uses the view; a caller that
 * DECIDES uses the layer it actually means, and the difference is no longer
 * something it has to know to work around.
 *
 * REFUSED IS NOT A LAYER. That is the whole of it.
 *
 * A write the store has judged and rejected can neither land nor leave. Merged
 * into reads it is shown as stored, indefinitely, across reloads — the
 * repository says this about itself: "somebody being shown their own rejected
 * copy of a board belonging to somebody else, for good." So a refusal goes to
 * a fourth place that no read ever consults.
 *
 * It is NOT discarded either, and this is the part the first draft of the plan
 * got wrong. Dropping it means the screen silently reverts, which this project
 * removed on purpose once already — a player sliding back with no explanation
 * reads as the app being broken. So refused work is kept, addressable, and
 * surfaced as refused: the board shows what is really stored, and the rejected
 * edit is presented as rejected, to be retried or abandoned deliberately.
 *
 * Stored / not yet / never. Three states, because the world has three, and the
 * model that had two is what turned every permission error into silent loss.
 */
import { requireBackend } from './contract';

/** @param {import('./contract').Backend} backend */
/**
 * @param {object} backend
 * @param {object} [options]
 * @param {Function} [options.onWatchError]
 * @param {() => boolean} [options.canWrite]  whether this person's writes may
 *   reach the shared store at all. Asked on every write, never captured: signing
 *   in happens while the app is running, and a captured answer kept an expert
 *   writing locally for a whole session.
 *
 *   A write that may not be sent is not an error and not a refusal — it is this
 *   person's own work, so it goes to `mine` and stays there. That is what lets a
 *   viewer build a board, reorder a roster and run a mock with no write access to
 *   the database those live in: he does not write to it, he writes OVER it. The
 *   overlay adapter existed to do this, one layer down, by merging two stores.
 */
export function createStore(backend, { onWatchError, canWrite } = {}) {
    requireBackend(backend);

    /** What the backend said, per collection. Never written to locally. */
    const shared = new Map();
    /**
     * This person's own documents, where a collection keeps them apart.
     *
     * PERSISTED, and this is the second capability that lets the overlay be
     * deleted rather than bypassed. The overlay keeps a viewer’s writes in
     * localStorage, which is what makes a play-along survive a reload — and a
     * viewer building a private mock over an expert’s board is the whole reason
     * this layer exists. In memory it is lost on every refresh, and a refresh is
     * what somebody does when a page looks stuck.
     *
     * The documents are persisted, unlike the WATERMARK, and the difference is
     * the point: a watermark without its documents claims a collection is
     * current when it holds nothing. These ARE the data — nobody else’s copy to
     * re-fetch.
     */
    const mine = new Map();
    /**
     * Issued, unacknowledged. Keyed `collection id`, one entry per document.
     *
     * The separator was a LITERAL NUL byte in the source — written as an
     * escape and saved as the character. Node tolerated it, so 769 tests
     * passed over it; esbuild does not, and every attempt to pattern-match
     * these lines failed for a reason nothing on screen explained. */
    const unsent = new Map();
    /** Judged and rejected. Read by nothing; shown by the interface. */
    const refused = new Map();

    /**
     * How far each collection has caught up, and whether it ever answered.
     *
     * IN MEMORY, and the audit was right that my first version should not have
     * been anything else. It persisted the watermark — the point — without the
     * documents, which is exactly the state forget() exists to prevent and says
     * so two hundred lines below: a point that outlives its data. A restored
     * point with an empty shared layer makes the next read ask for what changed
     * since then and merge the answer onto nothing, so a collection gets rebuilt
     * out of a handful of recent changes and reports itself current.
     *
     * It was inert today, because the legacy bridge ignores `since` and reads
     * everything — so it bought zero reads and was waiting to become wrong the
     * moment a real delta existed. The reads it was meant to save are real
     * (roughly 3,000 a day against 30), and saving them needs the DOCUMENTS
     * restored alongside the point. That is Phase 6 with the delta, not a field
     * written ahead of it.
     */
    const marks = new Map();

    const loading = new Map();
    const listeners = new Map();

    const key = (collection, id) => `${collection} ${id}`;
    // One key per store, named for the backend so a local build and a shared
    // one cannot read each other’s.
    const OWN_KEY = `db_own_${backend.name}_v1`;

    /**
     * Persists both own layers, COALESCED to once per tick.
     *
     * Not per write, which is what I did first: it serialises everything both
     * layers hold on every single change, so a loop that writes n times does
     * O(n²) work. The unit suite stopped finishing — the budget test writes 8,750
     * remarks — and it is the same shape as the per-player registry write that
     * pinned the main thread for fourteen seconds and crashed a renderer here.
     *
     * A tick is the right granularity because nothing can read this file between
     * two synchronous writes; only a reload can, and a reload cannot happen
     * mid-tick.
     */
    let pending = null;
    const writeOwn = () => {
        pending = null;
        try {
            globalThis.localStorage?.setItem(OWN_KEY, JSON.stringify({
                mine: Object.fromEntries([...mine.entries()]),
                unsent: [...unsent.values()],
            }));
        } catch { /* a full quota must not break a write */ }
    };
    const rememberOwn = ({ now = false } = {}) => {
        if (now) { if (pending) clearTimeout(pending); writeOwn(); return; }
        if (pending) return;
        pending = setTimeout(writeOwn, 0);
    };

    const recallOwn = () => {
        try {
            const raw = globalThis.localStorage?.getItem(OWN_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            Object.entries(saved?.mine ?? {}).forEach(([collection, docs]) => {
                if (docs && typeof docs === 'object') mine.set(collection, docs);
            });
            (saved?.unsent ?? []).forEach((c) => {
                if (c?.collection && c?.id !== undefined) unsent.set(key(c.collection, c.id), c);
            });
        } catch { /* unreadable is the same as absent */ }
    };

    // Whatever this person had not finished, and whatever is his own. Called
    // HERE and not at the declarations above: a `const` arrow referenced before
    // its own definition is a temporal dead zone, which is the second time that
    // has cost me a working app in this rebuild.
    recallOwn();

    const announce = (collection) => {
        (listeners.get(collection) ?? []).forEach((fn) => {
            try { fn(); } catch { /* a listener must not break a write */ }
        });
    };

    /** Applies a read result onto the shared layer. */
    function absorb(collection, result) {
        const base = result.complete ? {} : { ...(shared.get(collection) ?? {}) };
        Object.assign(base, result.docs ?? {});
        (result.removed ?? []).forEach((id) => { delete base[id]; });
        shared.set(collection, base);
        marks.set(collection, { at: result.watermark, answered: true, failed: false });
    }

    return {
        backend,
        capabilities: backend.capabilities,

        /**
         * The backend's own answer. Null when it has not given one.
         *
         * Null is a third answer and callers that decide must treat it as one:
         * "the store has not spoken" is not "the store says nothing". Reading
         * the second for the first is what convinced seeding it had already
         * run.
         */
        shared(collection) {
            return shared.get(collection) ?? null;
        },

        /** What to render: the store, this person's work, and what is in flight. */
        view(collection) {
            const out = { ...(shared.get(collection) ?? {}) };
            Object.entries(mine.get(collection) ?? {}).forEach(([id, doc]) => {
                if (doc === null) delete out[id]; else out[id] = doc;
            });
            unsent.forEach((w, k) => {
                // The same separator key() uses. A patch of mine turned this space
                // into a literal NEWLINE, so the prefix never matched and nothing in
                // flight was ever shown — a write vanished from the screen until it
                // landed. 769 tests passed throughout, because unsent is normally
                // empty a tick later.
                if (!k.startsWith(`${collection} `)) return;                 if (w.doc === null) delete out[w.id];
                // In flight and merging: show the document it will become, not the
                // handful of fields the change carries.
                else if (w.merge) out[w.id] = { ...(out[w.id] ?? {}), ...w.doc };
                else out[w.id] = w.doc;
            });
            return out;
        },

        /** Per layer, because "not answered" and "answered empty" differ. */
        readiness(collection) {
            const mark = marks.get(collection);
            return {
                answered: !!mark?.answered,
                failed: !!mark?.failed,
                loading: loading.has(collection),
                since: mark?.at ?? null,
            };
        },

        /**
         * Brings a collection up to date, by delta where the backend can.
         *
         * The watermark only advances on a read that fully succeeded — a
         * failure leaves it where it was, so catching up is always attempted
         * from the last point that actually worked and no change can be
         * stepped over.
         */
        ready(collection) {
            const inFlight = loading.get(collection);
            if (inFlight) return inFlight;

            const since = marks.get(collection)?.at;
            const run = Promise.resolve(backend.read(collection, since ? { since } : undefined))
                .then((result) => {
                    absorb(collection, result);
                    announce(collection);
                    return shared.get(collection);
                })
                .catch((error) => {
                    const mark = marks.get(collection);
                    marks.set(collection, { at: mark?.at, answered: !!mark?.answered, failed: true });
                    announce(collection);
                    throw error;
                })
                .finally(() => { loading.delete(collection); });

            loading.set(collection, run);
            return run;
        },

        /** Synchronous read, where the backend can answer without awaiting. */
        readSync(collection) {
            if (!backend.capabilities.sync || shared.has(collection)) return this.view(collection);
            absorb(collection, {
                docs: backend.readSync(collection), removed: [], watermark: String(Date.now()), complete: true,
            });
            return this.view(collection);
        },

        /**
         * Issues changes and reports what became of each.
         *
         * Held in `unsent` while in flight so the screen shows them at once,
         * then moved by outcome: stored ones fall through to the shared layer
         * on the next read, unreached ones stay unsent to be retried, and
         * refused ones move where no read will find them.
         */
        async write(changes) {
            // MINE, not sent. Either because the caller said so, or because this
            // person has no write access to the shared store — and the second is
            // the ordinary case for every viewer.
            const allowed = canWrite ? canWrite() : true;
            const own = changes.filter(c => c.mine || !allowed);
            const send = changes.filter(c => !(c.mine || !allowed));

            own.forEach((c) => {
                const layer = { ...(mine.get(c.collection) ?? {}) };
                if (c.merge && c.doc) layer[c.id] = { ...(layer[c.id] ?? {}), ...c.doc };
                else layer[c.id] = c.doc;
                mine.set(c.collection, layer);
            });
            if (own.length) {
                rememberOwn();
                new Set(own.map(c => c.collection)).forEach(announce);
            }
            if (!send.length) {
                return own.map(c => ({ collection: c.collection, id: c.id, outcome: 'stored' }));
            }
            changes = send;

            changes.forEach(c => unsent.set(key(c.collection, c.id), c));
            rememberOwn();
            new Set(changes.map(c => c.collection)).forEach(announce);

            const results = await backend.write(changes);

            results.forEach((r) => {
                const k = key(r.collection, r.id);
                const change = unsent.get(k);
                if (r.outcome === 'stored') {
                    unsent.delete(k);
                    // Reflected locally so the screen does not wait for a
                    // round trip it has already been told the answer to.
                    const base = { ...(shared.get(r.collection) ?? {}) };
                    if (change?.doc === null) delete base[r.id];
                    // A MERGE names the fields it changes and leaves the rest of the
                    // document alone — applied here exactly as the backend applies
                    // it, so the two cannot diverge over a field nobody mentioned.
                    // Replacing the record instead writes back every stale field the
                    // caller was holding, which is how a stale ownership field got a
                    // whole board of 328 entries refused.
                    else if (change?.merge) base[r.id] = { ...(base[r.id] ?? {}), ...change.doc };
                    else base[r.id] = change?.doc;
                    shared.set(r.collection, base);
                } else if (r.outcome === 'refused') {
                    unsent.delete(k);
                    refused.set(k, { ...change, error: r.error });
                }
                // unreached: left in `unsent`, which is where a retry finds it.
            });

            rememberOwn();
            new Set(results.map(r => r.collection)).forEach(announce);
            return [
                ...own.map(c => ({ collection: c.collection, id: c.id, outcome: 'stored' })),
                ...results,
            ];
        },

        /**
         * Whether this collection has been asked for at all.
         *
         * Distinct from empty — the distinction this whole store exists for, and
         * the one every caller migrating off the repository needs.
         */
        isLoaded(collection) {
            return !!marks.get(collection)?.answered;
        },

        /** Who is acting, forwarded. Null where the backend has no notion. */
        identity() {
            return backend.identity?.() ?? null;
        },

        /** Whether this store is shared with other people. */
        isShared() {
            return !!backend.capabilities.shared;
        },

        /**
         * Work the store rejected. Kept, never merged, shown as rejected.
         *
         * Neither of the two things that have already gone wrong here: not
         * displayed as stored, and not silently dropped so the screen reverts
         * with no explanation.
         */
        refused() {
            return [...refused.values()];
        },

        /** Abandons rejected work, deliberately. */
        discardRefused() {
            const n = refused.size;
            const touched = new Set([...refused.values()].map(c => c.collection));
            refused.clear();
            touched.forEach(announce);
            return n;
        },

        /** Work issued and not yet acknowledged. */
        pending() {
            return [...unsent.values()];
        },

        /** This person's own documents, kept apart from the shared ones. */
        setMine(collection, id, doc) {
            const own = { ...(mine.get(collection) ?? {}) };
            own[id] = doc;
            mine.set(collection, own);
            rememberOwn();
            announce(collection);
        },

        /**
         * Follows a collection, so somebody else's change arrives unasked.
         *
         * The capability that decides whether the overlay can be DELETED rather
         * than merely bypassed. `players` and `draft_state` are followed live —
         * a pick is a fact on a player, and that is how a follower sees the lead's
         * picks — so neither can move onto this store until it can watch.
         *
         * A snapshot is absorbed exactly as a read is: same merge, same
         * watermark, same `answered`. That is the point of the precedence model —
         * pushed and pulled data are the same layer, so `mine` and `unsent` keep
         * winning over both and a viewer's own work is never overwritten by
         * somebody else's snapshot arriving.
         *
         * Returns the unsubscribe. A backend that cannot push gets one read and
         * a no-op, so a caller does not have to ask which kind it has.
         */
        follow(collection, fn) {
            if (!backend.capabilities.push || typeof backend.watch !== 'function') {
                // No push: answer once, so a caller that only wants the data is
                // not left waiting for a snapshot that will never come.
                this.ready(collection).then(() => fn?.()).catch(() => {});
                return () => {};
            }

            const listeners = this.subscribe(collection, fn);
            const stop = backend.watch(
                collection,
                (result) => {
                    absorb(collection, result);
                    announce(collection);
                },
                (error) => {
                    const mark = marks.get(collection);
                    marks.set(collection, { at: mark?.at, answered: !!mark?.answered, failed: true });
                    announce(collection);
                    // Reported, not swallowed: a dead listener that looks alive is
                    // how a board sat stale on screen for a whole session.
                    onWatchError?.(collection, error);
                },
            );

            return () => { listeners(); stop?.(); };
        },

        subscribe(collection, fn) {
            const all = listeners.get(collection) ?? [];
            all.push(fn);
            listeners.set(collection, all);
            return () => listeners.set(collection, (listeners.get(collection) ?? []).filter(f => f !== fn));
        },

        /**
         * Forgets a collection entirely, watermark included.
         *
         * The watermark has to go with the documents. Keeping it would leave a
         * point in time with nothing behind it, so the next read would ask for
         * what changed since then and rebuild a collection out of a handful of
         * recent changes — an emptied cache presenting itself as a current one.
         */
        forget(collection) {
            if (collection == null) {
                [shared, mine, marks, loading].forEach(m => m.clear());
                unsent.clear();
                refused.clear();
                // The PERSISTED copy too, or a wipe comes back on the next load.
                // Measured: a scrapped season returned with its boards, because
                // forgetting cleared the maps and left the file that rebuilds them.
                // Immediately, not on a tick: a wipe is usually followed by a
                // reload, and a reload does not wait for a timer.
                rememberOwn({ now: true });
                return;
            }
            shared.delete(collection);
            mine.delete(collection);
            marks.delete(collection);
            loading.delete(collection);
            [...unsent.keys()].forEach((k) => {
                if (k.startsWith(`${collection} `)) unsent.delete(k);
            });
            rememberOwn();
        },
    };
}
