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

    it('is one key per collection, and the key is the path', () => {
        // A localStorage key is an arbitrary string and may contain a slash.
        // Folding the slashes into __ made storage look like the composite
        // keys the data model had just got rid of; putting the hierarchy in
        // the VALUE instead removed the __ and made one remark rewrite every
        // evaluation — 557ms at a season's scale. The key is just the path.
        expect(collectionKey('boards/b1/entries')).toBe('db_boards/b1/entries');
        expect(collectionKey('seasons/s_1/charts/rosterState/rows'))
            .toBe('db_seasons/s_1/charts/rosterState/rows');
        expect(collectionKey('players')).toBe('db_players');
    });

    it('writes only the collection that changed', async () => {
        const repo = createRepository(localAdapter);
        await repo.set('boards/b1/entries', 'p1', { round: 1 });
        await repo.set('boards/b2/entries', 'p2', { round: 2 });

        // Two keys, each holding one board — not one key holding both.
        expect(localStorage.getItem('db_boards/b1/entries')).toContain('p1');
        expect(localStorage.getItem('db_boards/b1/entries')).not.toContain('p2');
        expect(localStorage.getItem('db_boards/b2/entries')).toContain('p2');
    });

    it('keeps a document and the collections under it apart', async () => {
        // A season is BOTH a document in `seasons` and the parent of
        // seasons/{id}/charts. Separate keys, so neither can overwrite the
        // other.
        const repo = createRepository(localAdapter);
        await repo.set('seasons', 's_1', { year: 2026 });
        await repo.set('seasons/s_1/charts/rosterState/rows', 'qb', { slots: ['Mahomes'] });
        await Promise.all([
            repo.ready('seasons'),
            repo.ready('seasons/s_1/charts/rosterState/rows'),
        ]);

        expect(repo.get('seasons', 's_1').year).toBe(2026);
        expect(repo.get('seasons/s_1/charts/rosterState/rows', 'qb').slots).toEqual(['Mahomes']);
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
