import { describe, it, expect, beforeEach } from 'vitest';
import { createRepository } from '../../src/data/repository';

/**
 * A write that is neither acknowledged nor refused.
 *
 * Every existing test for the queue makes the store FAIL, which against
 * localStorage is the only way it can misbehave: setItem throws, the promise
 * rejects, `attempt` catches it and the write joins the queue that outlives
 * the tab. That path is well covered.
 *
 * A remote store has a third state. Offline, the Firestore SDK neither
 * resolves nor rejects a write — it buffers it in memory and waits, possibly
 * for ever. Nothing is thrown, so nothing is caught, so nothing is queued.
 * The repository's own note says why that matters: "a queue in memory is a
 * queue that a reload throws away, and a reload is exactly what somebody does
 * when the app seems stuck". An unacknowledged write is PRECISELY the state
 * where the app seems stuck — the indicator says "saving" and never stops.
 *
 * `initializeFirestore` is called without a local cache, so the SDK's own
 * buffer is memory-only too. If the repository has not written the change down
 * either, a reload loses it with no error anywhere.
 */
const QUEUE_KEY = 'pending_writes_v1';

/** A store that accepts a write and then never answers. */
const hangingAdapter = () => {
    const store = new Map();
    let hang = true;
    return {
        name: 'hanging',
        setHang(v) { hang = v; },
        async load(c) { return { ...(store.get(c) ?? {}) }; },
        set(c, id, doc) {
            if (hang) return new Promise(() => {});   // never settles
            store.set(c, { ...(store.get(c) ?? {}), [id]: doc });
            return Promise.resolve();
        },
        remove() { return hang ? new Promise(() => {}) : Promise.resolve(); },
        commit() { return hang ? new Promise(() => {}) : Promise.resolve(); },
    };
};

const queued = () => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null') ?? []; }
    catch { return []; }
};

describe('a write the store never answers', () => {
    beforeEach(() => { globalThis.resetStorage(); });

    it('says it is still saving rather than claiming it saved', async () => {
        const repo = createRepository(hangingAdapter());
        await repo.ready('boards');
        repo.set('boards', 'b1', { n: 'Dan' });
        await new Promise(r => setTimeout(r, 20));

        expect(repo.syncState().state).toBe('saving');
    });

    it('writes it down, so the reload somebody does when it looks stuck does not lose it', async () => {
        const repo = createRepository(hangingAdapter());
        await repo.ready('boards');
        repo.set('boards', 'b1', { n: 'Dan' });
        // Longer than the grace period: a write is only written down once it
        // is slow enough to be in doubt, which is what keeps localStorage from
        // paying for a protection it does not need.
        await new Promise(r => setTimeout(r, 400));

        // The whole promise of the persisted queue is that it outlives the
        // tab. A write still in flight is the one most likely to be sitting
        // there when the tab goes away.
        const saved = queued();
        expect(saved.map(w => w.id)).toContain('b1');
    });

    it('stops holding it once the store finally acknowledges', async () => {
        const adapter = hangingAdapter();
        adapter.setHang(false);
        const repo = createRepository(adapter);
        await repo.ready('boards');
        // A DIFFERENT id: the repository left hanging by the test above keeps
        // a live grace timer, and it fires into whatever localStorage exists
        // by then. Asserting on 'b1' here would be reading that straggler.
        await repo.set('boards', 'b3', { n: 'Dan' });
        await new Promise(r => setTimeout(r, 400));

        expect(queued().map(w => w.id)).not.toContain('b3');
        expect(repo.syncState().state).toBe('saved');
    });
});
