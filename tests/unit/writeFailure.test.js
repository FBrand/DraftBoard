import { describe, it, expect } from 'vitest';
import { createRepository } from '../../src/data/repository';

/**
 * Writes that do not land.
 *
 * The repository updates memory, notifies, and reaches the adapter after — the
 * right order for a UI that must not wait, and a lie if the write then fails.
 * Against localStorage it could only fail on a full quota, and the adapter
 * swallowed that: the app had already been told it worked, and the screen went
 * on showing a change that was never saved.
 *
 * Over a network it fails routinely — offline, a rule rejecting it, a timeout.
 * So the local change goes back and somebody is told.
 */
const adapterThat = ({ fail = false } = {}) => {
    const store = new Map();
    const boom = () => Promise.reject(new Error('write rejected'));
    return {
        name: 'test',
        async load(c) { return { ...(store.get(c) ?? {}) }; },
        loadSync(c) { return { ...(store.get(c) ?? {}) }; },
        async set(c, id, doc) {
            if (fail) return boom();
            store.set(c, { ...(store.get(c) ?? {}), [id]: doc });
        },
        async remove(c, id) {
            if (fail) return boom();
            const next = { ...(store.get(c) ?? {}) };
            delete next[id];
            store.set(c, next);
        },
        async commit(c, changes) {
            if (fail) return boom();
            const next = { ...(store.get(c) ?? {}) };
            changes.forEach(({ id, doc }) => { if (doc === null) delete next[id]; else next[id] = doc; });
            store.set(c, next);
        },
        seed(c, docs) { store.set(c, docs); },
    };
};

describe('a write that succeeds', () => {
    it('is visible immediately, before the adapter has finished', async () => {
        const repo = createRepository(adapterThat());
        const pending = repo.set('players', 'p1', { name: 'Fernando Mendoza' });

        // The point of writing to memory first: no await before the UI updates.
        expect(repo.get('players', 'p1').name).toBe('Fernando Mendoza');
        await pending;
        expect(repo.get('players', 'p1').name).toBe('Fernando Mendoza');
    });
});

describe('a write that fails', () => {
    it('KEEPS the change rather than putting it back', async () => {
        // This is the opposite of what it used to do, on purpose. Rolling back
        // is honest about storage and terrible for the person: the work is
        // gone and the only notice is a message saying so. Offline is Tuesday.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { name: 'Still Here' });
        expect(repo.get('players', 'p1').name).toBe('Still Here');
    });

    it('parks it and says how many are waiting', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { name: 'x' });

        const sync = repo.syncState();
        expect(sync.state).toBe('retrying');
        expect(sync.pending).toBe(1);
    });

    it('keeps one pending write per document, not one per attempt', async () => {
        // A player dragged five times while offline is one pending write
        // holding the latest position, not five holding a history.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { name: 'one' });
        await repo.set('players', 'p1', { name: 'two' });
        await repo.set('players', 'p1', { name: 'three' });

        expect(repo.syncState().pending).toBe(1);
        expect(repo.get('players', 'p1').name).toBe('three');
    });

    it('lands the moment the store comes back', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.set = () => Promise.reject(new Error('offline'));

        await repo.set('players', 'p1', { name: 'Fernando Mendoza' });
        expect(repo.syncState().state).toBe('retrying');

        // The store recovers, and the queue is emptied by hand the way the
        // "Try again" button does it.
        const store = new Map();
        adapter.set = async (c, id, doc) => { store.set(id, doc); };
        await repo.retryNow();

        expect(repo.syncState().state).toBe('saved');
        expect(store.get('p1').name).toBe('Fernando Mendoza');
    });

    it('tells somebody, with enough to say what failed', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        const seen = [];
        repo.onWriteError(e => seen.push(e));

        await repo.set('players', 'p1', { name: 'x' });

        expect(seen[0].collection).toBe('players');
        expect(seen[0].id).toBe('p1');
        expect(seen[0].error.message).toBe('write rejected');
    });

    it('announces the sync state as it changes', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        const states = [];
        repo.onSyncChange(s => states.push(s.state));

        await repo.set('players', 'p1', { name: 'x' });

        expect(states[0]).toBe('saved');          // on subscribe
        expect(states).toContain('saving');
        expect(states[states.length - 1]).toBe('retrying');
    });

    it('stops listening when told to', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        const seen = [];
        const off = repo.onWriteError(e => seen.push(e));
        off();

        await repo.set('players', 'p1', { name: 'x' });
        expect(seen).toHaveLength(0);
    });
});

describe('a batch that fails', () => {
    it('keeps every document in it, and queues them one by one', async () => {
        // Individually, so one poisoned document cannot hold the rest hostage
        // for ever — the store may well take the others.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.commit('players', [
            { id: 'p1', doc: { name: 'One' } },
            { id: 'p2', doc: { name: 'Two' } },
        ]);

        expect(repo.get('players', 'p1').name).toBe('One');
        expect(repo.get('players', 'p2').name).toBe('Two');
        expect(repo.syncState().pending).toBe(2);
    });

    it('queues a deletion as a deletion', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.seed('players', { p1: { name: 'One' } });
        await repo.ready('players');

        adapter.commit = () => Promise.reject(new Error('offline'));
        await repo.commit('players', [{ id: 'p1', doc: null }]);

        expect(repo.get('players', 'p1')).toBeNull();
        expect(repo.syncState().pending).toBe(1);

        const removed = [];
        adapter.remove = async (c, id) => { removed.push(id); };
        await repo.retryNow();
        expect(removed).toEqual(['p1']);
    });
});

describe('knowing whether a collection can be read yet', () => {
    const remoteish = () => ({
        name: 'remote',
        async load() { return {}; },   // no loadSync, like a real remote adapter
        async set() {},
        async remove() {},
    });

    it('is always ready against a local adapter, which can read on the spot', () => {
        const repo = createRepository(adapterThat());
        expect(repo.isLoaded('players')).toBe(true);
    });

    it('is not ready against a remote one until it has been read', async () => {
        const repo = createRepository(remoteish());
        expect(repo.isLoaded('players')).toBe(false);

        await repo.ready('players');
        expect(repo.isLoaded('players')).toBe(true);
    });
});
