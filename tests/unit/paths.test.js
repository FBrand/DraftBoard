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

    it('becomes a flat storage key, since localStorage has no hierarchy', () => {
        expect(collectionKey('boards/b1/entries')).toBe('db_boards__b1__entries');
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
