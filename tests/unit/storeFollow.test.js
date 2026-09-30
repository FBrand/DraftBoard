import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from '../../src/data/store';

/**
 * Following a collection on the layered store.
 *
 * This is the capability that decides whether the overlay adapter can be DELETED
 * rather than merely bypassed. `players` and `draft_state` are followed live — a
 * pick is a fact on a player, and that is how a follower sees the lead's picks —
 * so neither can move onto this store until it can watch.
 *
 * The property worth testing is not that a snapshot arrives. It is that a snapshot
 * is absorbed as the SHARED layer and nothing else, so a viewer's own work keeps
 * winning over it: the whole precedence model exists so pushed and pulled data are
 * the same thing, and a viewer building a private mock must not have it erased by
 * an expert's pick arriving.
 */
const pushable = () => {
    let push = null;
    let fail = null;
    return {
        emit: (docs, watermark = 'w1') => push?.({ docs, removed: [], watermark, complete: true }),
        break: (err) => fail?.(err),
        stopped: false,
        backend: {
            name: 'pushy',
            capabilities: { push: true, sync: false, refuses: false, shared: true },
            async read() { return { docs: {}, removed: [], watermark: 'w0', complete: true }; },
            async write(changes) {
                return changes.map(c => ({ collection: c.collection, id: c.id, outcome: 'stored' }));
            },
            watch(collection, onChange, onError) {
                push = onChange; fail = onError;
                return () => { push = null; };
            },
        },
    };
};

const quiet = {
    name: 'quiet',
    capabilities: { push: false, sync: false, refuses: false, shared: true },
    async read() { return { docs: { d_1: { v: 1 } }, removed: [], watermark: 'w0', complete: true }; },
    async write() { return []; },
};

beforeEach(() => { globalThis.resetStorage(); });

describe('following', () => {
    it('delivers a snapshot and announces it', async () => {
        const src = pushable();
        const store = createStore(src.backend);
        const seen = vi.fn();

        store.follow('players', seen);
        src.emit({ p_1: { n: 'One' } });

        expect(seen).toHaveBeenCalled();
        expect(store.view('players')).toEqual({ p_1: { n: 'One' } });
    });

    it('lets this person’s own work win over what arrives', async () => {
        // The reason pushed data is the shared layer and not a fourth one. A
        // viewer building a private mock must not have it erased by an expert's
        // pick landing.
        const src = pushable();
        const store = createStore(src.backend);
        store.follow('players', () => {});

        store.setMine('players', 'p_1', { n: 'My version' });
        src.emit({ p_1: { n: 'Theirs' } });

        expect(store.view('players').p_1).toEqual({ n: 'My version' });
        // And the shared layer really did take it, so discarding mine reveals it.
        expect(store.shared('players').p_1).toEqual({ n: 'Theirs' });
    });

    it('reports a dead listener instead of going quiet', async () => {
        const src = pushable();
        const onWatchError = vi.fn();
        const store = createStore(src.backend, { onWatchError });
        store.follow('players', () => {});

        src.break(new Error('permission-denied'));

        expect(onWatchError).toHaveBeenCalled();
        expect(store.readiness('players').failed).toBe(true);
    });

    it('stops when told to', async () => {
        const src = pushable();
        const store = createStore(src.backend);
        const seen = vi.fn();

        const stop = store.follow('players', seen);
        stop();
        src.emit({ p_2: { n: 'After' } });

        expect(seen).not.toHaveBeenCalled();
    });

    it('answers once on a backend that cannot push, rather than waiting forever', async () => {
        const store = createStore(quiet);
        const seen = vi.fn();

        store.follow('players', seen);
        await new Promise(r => setTimeout(r, 0));

        expect(seen).toHaveBeenCalled();
        expect(store.view('players')).toEqual({ d_1: { v: 1 } });
    });
});
