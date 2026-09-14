import { describe, it, expect } from 'vitest';
import { createRepository } from '../../src/data/repository';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';
import { localAdapter } from '../../src/data/localAdapter';

/**
 * The second adapter.
 *
 * Until something other than localStorage implements the interface, "the
 * backend is swappable" is a claim rather than a fact, and the first time it
 * gets tested is the first time it matters — against a real service, where
 * auth, rules and a network are all available to explain a failure that is
 * really none of them.
 *
 * The memory adapter deliberately does NOT implement loadSync, because no
 * network can. Everything here is about what changes when it is missing.
 */
const seeded = async (adapter) => {
    const repo = createRepository(adapter);
    await repo.set('players', 'p1', { id: 'p1', name: 'Fernando Mendoza' });
    return repo;
};

describe('both adapters satisfy the same interface', () => {
    for (const [label, make] of [['local', () => localAdapter], ['memory', () => createMemoryAdapter()]]) {
        describe(label, () => {
            it('writes, reads back, and removes', async () => {
                globalThis.resetStorage();
                const repo = await seeded(make());
                await repo.ready('players');

                expect(repo.get('players', 'p1').name).toBe('Fernando Mendoza');

                await repo.remove('players', 'p1');
                expect(repo.get('players', 'p1')).toBeNull();
            });

            it('commits a batch as one', async () => {
                globalThis.resetStorage();
                const repo = createRepository(make());
                await repo.commit('players', [
                    { id: 'a', doc: { id: 'a', name: 'One' } },
                    { id: 'b', doc: { id: 'b', name: 'Two' } },
                ]);
                await repo.ready('players');
                expect(repo.all('players')).toHaveLength(2);
            });

            it('queries with where and orderBy', async () => {
                globalThis.resetStorage();
                const repo = createRepository(make());
                await repo.commit('players', [
                    { id: 'a', doc: { id: 'a', name: 'One', position: 'QB', rank: 2 } },
                    { id: 'b', doc: { id: 'b', name: 'Two', position: 'QB', rank: 1 } },
                    { id: 'c', doc: { id: 'c', name: 'Three', position: 'WR', rank: 3 } },
                ]);
                await repo.ready('players');

                const qbs = repo.query('players', {
                    where: [['position', '==', 'QB']],
                    orderBy: { field: 'rank' },
                });
                expect(qbs.map(p => p.name)).toEqual(['Two', 'One']);
            });
        });
    }
});

describe('what changes without loadSync', () => {
    it('a synchronous read answers nothing until the collection is ready', async () => {
        const adapter = createMemoryAdapter();
        const repo = createRepository(adapter);
        await repo.set('players', 'p1', { id: 'p1', name: 'Fernando Mendoza' });

        // A fresh repository over the same adapter has read nothing yet. This
        // is the failure mode the whole app has to be audited for: not a
        // crash, an empty answer that looks like "no data".
        const cold = createRepository(adapter);
        expect(cold.all('players')).toEqual([]);
        expect(cold.isLoaded('players')).toBe(false);

        await cold.ready('players');
        expect(cold.isLoaded('players')).toBe(true);
        expect(cold.all('players')).toHaveLength(1);
    });

    it('localStorage answers immediately, which is why the gap hides locally', () => {
        globalThis.resetStorage();
        const repo = createRepository(localAdapter);
        expect(repo.isLoaded('players')).toBe(true);
    });
});

describe('a backend that refuses writes', () => {
    it('keeps the change and queues it, whichever adapter it is', async () => {
        const repo = createRepository(createMemoryAdapter({ failWrites: true }));
        const seen = [];
        repo.onWriteError(e => seen.push(e));

        await repo.set('players', 'p1', { name: 'x' });

        // Kept, not rolled back: losing the work is the failure being guarded
        // against, not an acceptable response to it.
        expect(repo.get('players', 'p1').name).toBe('x');
        expect(repo.syncState()).toMatchObject({ state: 'retrying', pending: 1 });
        expect(seen[0].collection).toBe('players');
    });
});
