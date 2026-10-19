import { describe, it, expect } from 'vitest';
import { createRepository } from '../../src/data/repository';

/**
 * `ready()` has to mean the store answered.
 *
 * A write primes the in-memory copy for a collection that may never have
 * loaded — `applyLocal` and `commit` both have to, or the change would not show
 * until the network agreed. `ready()` used to read that primed copy as "this
 * collection is loaded" and never ask the store at all.
 *
 * Against localStorage the bug is invisible, because the write went to the same
 * place the read would have come from. Against a remote store it decided
 * whether anyone could follow a broadcast: a viewer opened the app, something
 * wrote one document before the season arrived, `openBoards()` awaited a
 * `ready()` that resolved instantly on an almost-empty collection, concluded
 * nobody had ever made a board, and seeded a private season over the expert's.
 * The viewer then sat watching his own copy of the shipped CSVs. Six boots out
 * of six against the emulator.
 *
 * A remote adapter, which is to say: no `loadSync`, and `load` resolves later.
 */
const remoteAdapter = (seed = {}) => {
    const store = new Map(Object.entries(seed).map(([c, d]) => [c, { ...d }]));
    let loads = 0;
    return {
        name: 'remote',
        get loads() { return loads; },
        async load(c) {
            loads += 1;
            await new Promise(r => setTimeout(r, 5));
            return { ...(store.get(c) ?? {}) };
        },
        async set(c, id, doc) { store.set(c, { ...(store.get(c) ?? {}), [id]: doc }); },
        async remove(c, id) { const n = { ...(store.get(c) ?? {}) }; delete n[id]; store.set(c, n); },
        async commit(c, changes) {
            const n = { ...(store.get(c) ?? {}) };
            changes.forEach(({ id, doc }) => { if (doc === null) delete n[id]; else n[id] = doc; });
            store.set(c, n);
        },
    };
};

describe('ready() after a write to a collection that never loaded', () => {
    it('still reads the store, and the store’s documents are all there', async () => {
        const adapter = remoteAdapter({ boards: { b_dan: { l: 'Dan' }, b_ryan: { l: 'Ryan' } } });
        const repo = createRepository(adapter);

        // Something writes before anything has loaded. This is the whole bug:
        // one document in memory for a collection holding three.
        repo.set('boards', 'b_mine', { l: 'Mine' });

        await repo.ready('boards');

        expect(adapter.loads).toBe(1);
        expect(Object.keys(repo.docs('boards')).sort()).toEqual(['b_dan', 'b_mine', 'b_ryan']);
    });

    it('does not report a populated collection as empty', async () => {
        // The exact shape of the seeding decision: "has anybody made a board?"
        const adapter = remoteAdapter({ boards: { b_dan: { l: 'Dan' } } });
        const repo = createRepository(adapter);

        repo.set('players', 'p_1', { n: 'Somebody' }); // an unrelated collection
        repo.set('boards', 'b_scratch', { l: 'Scratch' });

        await repo.ready('boards');
        expect(repo.all('boards').length).toBeGreaterThan(1);
    });

    it('loads once and serves from memory after', async () => {
        const adapter = remoteAdapter({ seasons: { s_1: { y: 2026 } } });
        const repo = createRepository(adapter);

        await repo.ready('seasons');
        await repo.ready('seasons');
        repo.set('seasons', 's_2', { y: 2027 });
        await repo.ready('seasons');

        expect(adapter.loads).toBe(1);
        expect(repo.all('seasons')).toHaveLength(2);
    });

    it('a pending write still beats the store’s answer', async () => {
        // The reason the cache is primed at all — `withPending` must keep
        // winning now that the load is no longer skipped.
        const adapter = remoteAdapter({ boards: { b_dan: { l: 'Dan' } } });
        const repo = createRepository(adapter);

        repo.set('boards', 'b_dan', { l: 'Renamed' });
        await repo.ready('boards');

        expect(repo.get('boards', 'b_dan').l).toBe('Renamed');
    });

    it('re-reads after invalidate, which is what a wipe depends on', async () => {
        const adapter = remoteAdapter({ boards: { b_dan: { l: 'Dan' } } });
        const repo = createRepository(adapter);

        await repo.ready('boards');
        repo.invalidate('boards');
        await repo.ready('boards');

        expect(adapter.loads).toBe(2);
    });
});
