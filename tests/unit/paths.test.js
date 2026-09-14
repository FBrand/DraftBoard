import { describe, it, expect, beforeEach } from 'vitest';
import { createRepository } from '../../src/data/repository';
import { localAdapter, collectionKey } from '../../src/data/localAdapter';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * Slash-separated collection paths.
 *
 * `boards/b1/entries` is how Firestore spells "this board's entries", and it
 * is what makes a rule about them writable in one line rather than a filter
 * over a shared collection. The question was whether the repository could
 * carry such a path at all, or whether it was a change to the interface.
 *
 * It carries it: the local adapter already folds the separators into its key.
 * That is worth a test rather than a comment, because it is load-bearing for
 * the backend swap and entirely invisible from the call sites.
 */
beforeEach(() => { globalThis.resetStorage(); });

/** Through the Storage interface, not Object.keys — see localAdapter. */
const storageKeys = () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) out.push(localStorage.key(i));
    return out;
};

describe('a path with slashes in it', () => {
    it('is a usable collection against the local adapter', async () => {
        const repo = createRepository(localAdapter);
        await repo.set('boards/b1/entries', 'p_mendoza', { id: 'p_mendoza', name: 'Fernando Mendoza' });
        await repo.ready('boards/b1/entries');

        expect(repo.get('boards/b1/entries', 'p_mendoza').name).toBe('Fernando Mendoza');
    });

    it('keeps two boards in separate collections, not one filtered list', async () => {
        const repo = createRepository(localAdapter);
        await repo.set('boards/b1/entries', 'p1', { id: 'p1', name: 'One' });
        await repo.set('boards/b2/entries', 'p2', { id: 'p2', name: 'Two' });
        await Promise.all([repo.ready('boards/b1/entries'), repo.ready('boards/b2/entries')]);

        expect(repo.all('boards/b1/entries').map(d => d.name)).toEqual(['One']);
        expect(repo.all('boards/b2/entries').map(d => d.name)).toEqual(['Two']);
    });

    it('is one key per ROOT collection, with the hierarchy inside the value', () => {
        // localStorage is flat and the data is not. This used to fold the
        // slashes into the key — db_boards__b1__entries — which put a wall of
        // __-joined strings in front of anyone opening a storage inspector,
        // indistinguishable from the composite keys the data model had just
        // got rid of. The nesting lives in the value now.
        expect(collectionKey('boards/b1/entries')).toBe('db_boards');
        expect(collectionKey('seasons/s_1/charts/rosterState/rows')).toBe('db_seasons');
        expect(collectionKey('players')).toBe('db_players');
    });

    it('keeps a document and the collections under it apart', async () => {
        // A season is BOTH a document in `seasons` and the parent of
        // seasons/{id}/charts. Without separating them, one would overwrite
        // the other.
        const repo = createRepository(localAdapter);
        await repo.set('seasons', 's_1', { year: 2026 });
        await repo.set('seasons/s_1/charts/rosterState/rows', 'qb', { slots: ['Mahomes'] });
        await Promise.all([
            repo.ready('seasons'),
            repo.ready('seasons/s_1/charts/rosterState/rows'),
        ]);

        expect(repo.get('seasons', 's_1').year).toBe(2026);
        expect(repo.get('seasons/s_1/charts/rosterState/rows', 'qb').slots).toEqual(['Mahomes']);

        const raw = JSON.parse(localStorage.getItem('db_seasons'));
        expect(raw.docs.s_1.year).toBe(2026);
        expect(raw.sub.s_1.sub.charts.sub.rosterState.sub.rows.docs.qb.slots).toEqual(['Mahomes']);
    });

    it('leaves no __ keys in storage at all', () => {
        const joined = storageKeys().filter(k => k.startsWith('db_') && k.includes('__'));
        expect(joined, 'a flattened path key survived').toEqual([]);
    });

    it('works the same against an adapter that is not localStorage', async () => {
        const repo = createRepository(createMemoryAdapter());
        await repo.set('boards/b1/entries', 'p1', { id: 'p1', name: 'One' });
        await repo.ready('boards/b1/entries');
        expect(repo.all('boards/b1/entries')).toHaveLength(1);
    });

    it('loads one board without loading every board', async () => {
        // The reason to prefer this over a shared collection with a scope
        // field: opening a board should not read five seasons of history.
        const repo = createRepository(createMemoryAdapter());
        await repo.set('boards/b1/entries', 'p1', { id: 'p1', name: 'One' });
        await repo.set('boards/b2/entries', 'p2', { id: 'p2', name: 'Two' });

        const cold = createRepository(createMemoryAdapter());
        await cold.ready('boards/b1/entries');
        expect(cold.isLoaded('boards/b1/entries')).toBe(true);
        expect(cold.isLoaded('boards/b2/entries')).toBe(false);
    });
});

/**
 * Data written by the build that flattened paths into keys.
 *
 * Everything an existing user has is under `db_seasons__s_1__charts__…`. The
 * new reader never looks there, so without this the first load of the new
 * build shows an empty app — every board, every roster, every evaluation
 * apparently gone. They are not gone; they are at an address nothing asks for.
 */
describe('keys written by the flattened build', () => {
    it('are folded into the tree on the first read, and removed', async () => {
        localStorage.setItem('db_seasons__s_1__charts__rosterState__rows',
            JSON.stringify({ qb: { slots: ['Mahomes'] } }));
        localStorage.setItem('db_seasons', JSON.stringify({ docs: { s_1: { year: 2026 } } }));

        const repo = createRepository(localAdapter);
        await repo.ready('seasons/s_1/charts/rosterState/rows');

        expect(repo.get('seasons/s_1/charts/rosterState/rows', 'qb').slots).toEqual(['Mahomes']);
        expect(localStorage.getItem('db_seasons__s_1__charts__rosterState__rows')).toBeNull();
    });

    it('do not displace what is already in the tree', async () => {
        localStorage.setItem('db_seasons', JSON.stringify({ docs: { s_1: { year: 2026 } } }));
        localStorage.setItem('db_seasons__s_1__charts__rosterState__rows',
            JSON.stringify({ qb: { slots: ['Mahomes'] } }));

        const repo = createRepository(localAdapter);
        await Promise.all([repo.ready('seasons'), repo.ready('seasons/s_1/charts/rosterState/rows')]);

        expect(repo.get('seasons', 's_1').year).toBe(2026);
        expect(repo.get('seasons/s_1/charts/rosterState/rows', 'qb')).toBeTruthy();
    });

    it('carry a deep evaluation path across intact', async () => {
        const key = 'db_evaluations__p_delane__n__b_consensus__s_2026';
        localStorage.setItem(key, JSON.stringify({ k3f9x2: { t: 'Sticky in man coverage', a: 1 } }));

        const repo = createRepository(localAdapter);
        await repo.ready('evaluations/p_delane/n/b_consensus/s_2026');

        expect(repo.get('evaluations/p_delane/n/b_consensus/s_2026', 'k3f9x2').t)
            .toBe('Sticky in man coverage');
        expect(localStorage.getItem(key)).toBeNull();
        expect(storageKeys().filter(k => k.startsWith('db_') && k.includes('__')))
            .toEqual([]);
    });
});
