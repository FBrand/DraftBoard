import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/data/store';

/**
 * A person's own work survives a reload.
 *
 * This is the second of the two capabilities that decide whether the overlay
 * adapter can be DELETED rather than bypassed. The overlay keeps a viewer's
 * writes in localStorage — that is what makes a play-along survive a refresh, and
 * a refresh is exactly what somebody does when a page looks stuck. The layered
 * store held `mine` and `unsent` in memory, so moving a collection across would
 * have lost a viewer's mock on every reload.
 *
 * Note what is and is not persisted, because the distinction is the whole
 * argument: these documents ARE the data, nobody else's copy to re-fetch, so they
 * are kept. The WATERMARK is not, because a point without its documents claims a
 * collection is current when it holds nothing.
 */
const backend = (log = []) => ({
    name: 'ownlayers',
    capabilities: { push: false, sync: false, refuses: false, shared: true },
    async read() { return { docs: {}, removed: [], watermark: 'w', complete: true }; },
    async write(changes) {
        log.push(...changes);
        // Nothing lands: every write stays unacknowledged, which is the state
        // that has to survive a reload.
        return changes.map(c => ({ collection: c.collection, id: c.id, outcome: 'unreached' }));
    },
});

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { globalThis.resetStorage(); });

describe('this person’s own layers', () => {
    it('come back after a reload', async () => {
        const first = createStore(backend());
        first.setMine('boards', 'b_1', { l: 'My board' });
        await tick();

        // A reload: a new store over the same storage.
        const second = createStore(backend());
        expect(second.view('boards')).toEqual({ b_1: { l: 'My board' } });
    });

    it('bring an unacknowledged write back with them', async () => {
        const first = createStore(backend());
        await first.write([{ collection: 'boards', id: 'b_2', doc: { l: 'Not saved yet' } }]);
        await tick();
        expect(first.pending()).toHaveLength(1);

        const second = createStore(backend());
        expect(second.pending()).toHaveLength(1);
        expect(second.view('boards').b_2).toEqual({ l: 'Not saved yet' });
    });

    it('do not bring the watermark back, because its documents are not kept', async () => {
        const first = createStore(backend());
        await first.ready('boards');
        await tick();

        const second = createStore(backend());
        expect(second.readiness('boards').since).toBeNull();
        expect(second.shared('boards')).toBeNull();
    });

    it('are cleared by a wipe, immediately', async () => {
        const first = createStore(backend());
        first.setMine('boards', 'b_3', { l: 'Doomed' });
        await tick();

        // No tick after forget: a wipe is followed by a reload, and a reload does
        // not wait for a timer.
        first.forget(null);
        const second = createStore(backend());
        expect(second.view('boards')).toEqual({});
    });

    it('are written once per tick, not once per write', async () => {
        // Persisting per write serialises everything both layers hold on every
        // change — O(n²) for a loop, and the unit suite stopped finishing when I
        // did it that way. Same shape as the per-player registry write that pinned
        // the main thread for fourteen seconds.
        const store = createStore(backend());
        let writes = 0;
        const real = globalThis.localStorage.setItem.bind(globalThis.localStorage);
        globalThis.localStorage.setItem = (k, v) => { if (k.startsWith('db_own_')) writes += 1; return real(k, v); };

        for (let i = 0; i < 50; i += 1) store.setMine('boards', `b_${i}`, { l: `${i}` });
        expect(writes).toBe(0);      // nothing yet: all fifty coalesce
        await tick();
        expect(writes).toBe(1);
    });
});
