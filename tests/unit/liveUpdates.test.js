import { describe, it, expect, vi } from 'vitest';
import { createRepository } from '../../src/data/repository';
import { createOverlayAdapter } from '../../src/data/overlayAdapter';

/**
 * Following a board, rather than reading one.
 *
 * The adapter read the shared store once, with `getDocs`, and never again — so
 * a viewer saw an expert's board as it stood when he opened the page and
 * nothing after it. For a tool whose whole purpose is that ten thousand people
 * watch Dan make a pick, "reload to see it" is not the feature.
 *
 * A store that cannot change behind the app's back — localStorage — has no
 * `watch`, starts no watcher, and behaves exactly as it did.
 *
 * Following is asked for, per collection, and counted. Watching everything the
 * app loads meant twenty open streams per viewer — twenty times the reads on a
 * real project, and enough against the emulator to wedge the client offline,
 * where writes queue for ever and nothing says why. A board is worth
 * following; the season record is read once and changes almost never.
 */
const watchableRemote = (seed = {}) => {
    const store = new Map(Object.entries(seed).map(([c, d]) => [c, { ...d }]));
    const listeners = new Map();
    return {
        name: 'remote',
        async load(c) { return { ...(store.get(c) ?? {}) }; },
        async set(c, id, doc) { store.set(c, { ...(store.get(c) ?? {}), [id]: doc }); },
        async remove(c, id) { const n = { ...(store.get(c) ?? {}) }; delete n[id]; store.set(c, n); },
        watch(c, onDocs) {
            listeners.set(c, onDocs);
            return () => listeners.delete(c);
        },
        /** Somebody else changed it. */
        push(c, docs) {
            store.set(c, { ...docs });
            listeners.get(c)?.({ ...docs });
        },
        watching: (c) => listeners.has(c),
    };
};

const localStore = () => {
    const m = new Map();
    return {
        name: 'local',
        async load(p) { return { ...(m.get(p) ?? {}) }; },
        loadSync(p) { return { ...(m.get(p) ?? {}) }; },
        async set(p, id, doc) { m.set(p, { ...(m.get(p) ?? {}), [id]: doc }); },
        async remove(p, id) { const n = { ...(m.get(p) ?? {}) }; delete n[id]; m.set(p, n); },
    };
};

describe('a store that pushes', () => {
    it('updates the collection without anybody asking again', async () => {
        const remote = watchableRemote({ 'boards/b1/entries': { p_1: { r: 6 } } });
        const repo = createRepository(remote);

        await repo.ready('boards/b1/entries');
        repo.follow('boards/b1/entries', () => {});
        expect(repo.get('boards/b1/entries', 'p_1').r).toBe(6);

        // The expert moves him.
        remote.push('boards/b1/entries', { p_1: { r: 1 } });
        expect(repo.get('boards/b1/entries', 'p_1').r).toBe(1);
    });

    it('tells the views, so the screen follows', async () => {
        const remote = watchableRemote({ c: { a: { v: 1 } } });
        const repo = createRepository(remote);
        await repo.ready('c');

        const seen = vi.fn();
        repo.follow('c', seen);
        remote.push('c', { a: { v: 2 } });

        expect(seen).toHaveBeenCalled();
    });

    it('lets a pending write win over what the store sends back', async () => {
        // He has just dragged a player. A snapshot carrying the old position
        // must not yank him back across the board.
        const remote = watchableRemote({ c: { a: { r: 5 } } });
        let release;
        remote.set = () => new Promise(r => { release = r; });
        const repo = createRepository(remote);
        await repo.ready('c');
        repo.follow('c', () => {});

        repo.set('c', 'a', { r: 1 });          // in flight, not acknowledged
        remote.push('c', { a: { r: 5 } });     // the store still says 5

        expect(repo.get('c', 'a').r).toBe(1);
        release?.();
    });

    it('stops watching a collection that has been invalidated', async () => {
        const remote = watchableRemote({ c: { a: { v: 1 } } });
        const repo = createRepository(remote);
        await repo.ready('c');
        repo.follow('c', () => {});
        expect(remote.watching('c')).toBe(true);

        repo.invalidate('c');
        expect(remote.watching('c')).toBe(false);
    });

    it('opens one watch however many callers follow it', async () => {
        const remote = watchableRemote({ c: {} });
        const spy = vi.spyOn(remote, 'watch');
        const repo = createRepository(remote);
        await repo.ready('c');

        const a = repo.follow('c', () => {});
        const b = repo.follow('c', () => {});
        const d = repo.follow('c', () => {});

        expect(spy).toHaveBeenCalledTimes(1);

        // And it stays open until the last one leaves.
        a(); b();
        expect(remote.watching('c')).toBe(true);
        d();
        expect(remote.watching('c')).toBe(false);
    });

    it('opens nothing for a collection merely read', async () => {
        // Twenty collections load at boot. Following all of them is twenty
        // streams nobody asked for.
        const remote = watchableRemote({ c: {} });
        const spy = vi.spyOn(remote, 'watch');
        const repo = createRepository(remote);

        await repo.ready('c');

        expect(spy).not.toHaveBeenCalled();
    });
});

describe('a store that cannot change behind the app’s back', () => {
    it('starts no watcher at all', async () => {
        const local = localStore();
        const repo = createRepository(local);
        await repo.ready('c');
        expect(local.watch).toBeUndefined();  // nothing to stop, nothing to leak
        expect(repo.all('c')).toEqual([]);
    });
});

describe('the overlay, following the shared store', () => {
    it('keeps the viewer’s own work on top of every update', async () => {
        // The failure this guards: an expert moves the same player a viewer has
        // tagged, and the update quietly discards the viewer's tag.
        const remote = watchableRemote({ c: { p_1: { r: 6 } } });
        const local = localStore();
        await local.set('c', 'p_1', { r: 6, g: 'avoid' });

        const overlay = createOverlayAdapter({ remote, local, writesRemote: () => false });
        const repo = createRepository(overlay);
        await repo.ready('c');
        repo.follow('c', () => {});
        expect(repo.get('c', 'p_1').g).toBe('avoid');

        remote.push('c', { p_1: { r: 1 } });

        const after = repo.get('c', 'p_1');
        expect(after.g).toBe('avoid');   // still his
    });

    it('offers no watch when the shared half cannot push', async () => {
        const remote = { name: 'r', async load() { return {}; }, async set() {}, async remove() {} };
        const overlay = createOverlayAdapter({ remote, local: localStore(), writesRemote: () => false });
        expect(overlay.watch).toBeUndefined();
    });
});
