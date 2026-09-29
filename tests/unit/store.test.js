import { describe, it, expect } from 'vitest';
import { createStore } from '../../src/data/store';

/**
 * The layered store exists to make one distinction the repository destroyed:
 * what the STORE said, versus what this browser believes. Every test here is
 * about a caller that needed that and could not ask.
 */
const backendThat = ({ refuse = false, unreach = false, seed = {} } = {}) => {
    const docs = { ...seed };
    return {
        name: 'test',
        capabilities: { push: false, sync: false, refuses: true, shared: true },
        async read() {
            return { docs: { ...docs }, removed: [], watermark: '1', complete: true };
        },
        async write(changes) {
            return changes.map((c) => {
                if (refuse) return { collection: c.collection, id: c.id, outcome: 'refused', error: new Error('permission-denied') };
                if (unreach) return { collection: c.collection, id: c.id, outcome: 'unreached', error: new Error('offline') };
                if (c.doc === null) delete docs[c.id]; else docs[c.id] = c.doc;
                return { collection: c.collection, id: c.id, outcome: 'stored' };
            });
        },
    };
};

describe('what the store said, versus what we believe', () => {
    it('does not let a refused write answer for the store', async () => {
        const s = createStore(backendThat({ refuse: true }));
        await s.ready('boards');
        await s.write([{ collection: 'boards', id: 'b1', doc: { l: 'Mine' } }]);

        // The database holds nothing, and says so.
        expect(Object.keys(s.shared('boards'))).toHaveLength(0);
        // And the rendered view does not show it either — a rejected write is
        // not a layer. This is the difference from the old model.
        expect(Object.keys(s.view('boards'))).toHaveLength(0);
    });

    it('keeps refused work rather than dropping it', async () => {
        const s = createStore(backendThat({ refuse: true }));
        await s.ready('boards');
        await s.write([{ collection: 'boards', id: 'b1', doc: { l: 'Mine' } }]);

        // Not shown as stored, not silently discarded. Both have already gone
        // wrong here: the first hid an empty database for weeks, the second
        // makes the screen revert with no explanation.
        const held = s.refused();
        expect(held).toHaveLength(1);
        expect(held[0].doc.l).toBe('Mine');
        expect(s.discardRefused()).toBe(1);
        expect(s.refused()).toHaveLength(0);
    });

    it('shows an unreached write, because it is still coming', async () => {
        const s = createStore(backendThat({ unreach: true }));
        await s.ready('boards');
        await s.write([{ collection: 'boards', id: 'b1', doc: { l: 'Not saved yet' } }]);

        expect(s.view('boards').b1.l).toBe('Not saved yet');   // on screen
        expect(s.shared('boards').b1).toBeUndefined();          // not in the store
        expect(s.pending()).toHaveLength(1);                    // and will be retried
    });

    it('says null for a collection the store has not answered for', () => {
        const s = createStore(backendThat());
        // The third answer. "Has not spoken" is not "says nothing", and
        // reading the second for the first is what convinced seeding it had
        // already run against a project it had never written to.
        expect(s.shared('boards')).toBeNull();
        expect(s.readiness('boards').answered).toBe(false);
    });

    it('reports readiness per layer, so a decision can wait for the store', async () => {
        const s = createStore(backendThat({ seed: { b1: { l: 'Consensus' } } }));
        expect(s.readiness('boards')).toMatchObject({ answered: false, failed: false });
        await s.ready('boards');
        expect(s.readiness('boards')).toMatchObject({ answered: true, failed: false });
        expect(s.shared('boards').b1.l).toBe('Consensus');
    });
});

describe('the watermark', () => {
    it('does not advance when a read fails', async () => {
        let ok = true;
        const s = createStore({
            name: 'flaky',
            capabilities: { push: false, sync: false, refuses: false, shared: true },
            async read() {
                if (!ok) throw new Error('unreachable');
                return { docs: { a: { v: 1 } }, removed: [], watermark: '7', complete: true };
            },
            async write(c) { return c.map(x => ({ collection: x.collection, id: x.id, outcome: 'stored' })); },
        });

        await s.ready('players');
        expect(s.readiness('players').since).toBe('7');

        ok = false;
        await expect(s.ready('players')).rejects.toThrow('unreachable');

        // Catching up is always attempted from the last point that fully
        // succeeded, or a change can be stepped over and never seen again.
        expect(s.readiness('players').since).toBe('7');
        expect(s.readiness('players').failed).toBe(true);
    });

    it('applies a delta onto what is already held, and honours removals', async () => {
        let call = 0;
        const s = createStore({
            name: 'delta',
            capabilities: { push: false, sync: false, refuses: false, shared: true },
            async read() {
                call += 1;
                return call === 1
                    ? { docs: { a: { v: 1 }, b: { v: 1 } }, removed: [], watermark: '1', complete: true }
                    : { docs: { b: { v: 2 } }, removed: ['a'], watermark: '2', complete: false };
            },
            async write(c) { return c.map(x => ({ collection: x.collection, id: x.id, outcome: 'stored' })); },
        });

        await s.ready('players');
        await s.ready('players');

        const held = s.shared('players');
        expect(held.b.v).toBe(2);
        // Removed, not merely absent from the page. A reader cannot otherwise
        // tell "deleted" from "not in this batch".
        expect(held.a).toBeUndefined();
        expect(s.readiness('players').since).toBe('2');
    });
});

describe('this person own work', () => {
    it('sits above the store without overwriting it', async () => {
        const s = createStore(backendThat({ seed: { p1: { n: 'Theirs' } } }));
        await s.ready('players');
        s.setMine('players', 'p1', { n: 'Mine' });

        expect(s.view('players').p1.n).toBe('Mine');
        expect(s.shared('players').p1.n).toBe('Theirs');
    });
});
