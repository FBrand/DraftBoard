import { describe, it, expect, vi } from 'vitest';
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
    it('puts back what was there', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.seed('players', { p1: { name: 'Before' } });
        await repo.ready('players');

        adapter.set = () => Promise.reject(new Error('offline'));
        await expect(repo.set('players', 'p1', { name: 'After' })).rejects.toThrow('offline');

        expect(repo.get('players', 'p1').name).toBe('Before');
    });

    it('removes a document it had added, rather than leaving a ghost', async () => {
        const adapter = adapterThat({ fail: true });
        const repo = createRepository(adapter);

        await expect(repo.set('players', 'p1', { name: 'Never Saved' })).rejects.toThrow();
        expect(repo.get('players', 'p1')).toBeNull();
    });

    it('brings back a document whose deletion failed', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.seed('players', { p1: { name: 'Still Here' } });
        await repo.ready('players');

        adapter.remove = () => Promise.reject(new Error('offline'));
        await expect(repo.remove('players', 'p1')).rejects.toThrow();

        expect(repo.get('players', 'p1').name).toBe('Still Here');
    });

    it('tells somebody, with enough to say what failed', async () => {
        const adapter = adapterThat({ fail: true });
        const repo = createRepository(adapter);
        const seen = [];
        repo.onWriteError(e => seen.push(e));

        await expect(repo.set('players', 'p1', { name: 'x' })).rejects.toThrow();

        expect(seen).toHaveLength(1);
        expect(seen[0].collection).toBe('players');
        expect(seen[0].id).toBe('p1');
        expect(seen[0].op).toBe('set');
        expect(seen[0].error.message).toBe('write rejected');
    });

    it('notifies subscribers of the rollback, so the screen follows it back', async () => {
        const adapter = adapterThat({ fail: true });
        const repo = createRepository(adapter);
        const seen = vi.fn();
        repo.subscribe('players', seen);

        await expect(repo.set('players', 'p1', { name: 'x' })).rejects.toThrow();

        // Once for the optimistic write, once for putting it back.
        expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('stops listening when told to', async () => {
        const adapter = adapterThat({ fail: true });
        const repo = createRepository(adapter);
        const seen = [];
        const off = repo.onWriteError(e => seen.push(e));
        off();

        await expect(repo.set('players', 'p1', { name: 'x' })).rejects.toThrow();
        expect(seen).toHaveLength(0);
    });
});

describe('a batch that fails', () => {
    it('puts every document in it back, not just the first', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.seed('players', { p1: { name: 'One' }, p2: { name: 'Two' } });
        await repo.ready('players');

        adapter.commit = () => Promise.reject(new Error('offline'));
        await expect(repo.commit('players', [
            { id: 'p1', doc: { name: 'One Changed' } },
            { id: 'p2', doc: { name: 'Two Changed' } },
            { id: 'p3', doc: { name: 'Three Added' } },
        ])).rejects.toThrow();

        expect(repo.get('players', 'p1').name).toBe('One');
        expect(repo.get('players', 'p2').name).toBe('Two');
        expect(repo.get('players', 'p3')).toBeNull();
    });

    it('puts back a deletion that was part of the batch', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.seed('players', { p1: { name: 'One' } });
        await repo.ready('players');

        adapter.commit = () => Promise.reject(new Error('offline'));
        await expect(repo.commit('players', [{ id: 'p1', doc: null }])).rejects.toThrow();

        expect(repo.get('players', 'p1').name).toBe('One');
    });
});

/**
 * "Nothing here" and "not loaded yet" are different answers.
 *
 * To every caller they are the same empty array, and against a local adapter
 * they always will be — loadSync fills the cache on the spot. Against a remote
 * one a caller that cannot tell them apart reports the wrong one: the add form
 * would say "no matching players" while the registry was still arriving, and
 * let somebody add a duplicate of a player it had simply not seen yet.
 */
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
