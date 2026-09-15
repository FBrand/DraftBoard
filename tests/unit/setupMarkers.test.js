import { describe, it, expect, beforeEach } from 'vitest';
import { createRepository } from '../../src/data/repository';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * The markers that stop a season being set up twice.
 *
 * `seasons/{id}/setup` holds two of them: `season`, written when a season's
 * stages are laid down, and `facts`, written when the shipped player facts have
 * been applied. Both exist so that whoever gets there first does the work and
 * everybody else reads the marker and does nothing — which is the point of
 * keeping them in the STORE rather than in this browser.
 *
 * Both are read synchronously, through `repository.get`. Against localStorage
 * that always works, because `loadSync` fills the collection the instant
 * anything asks. Against a store that answers later it returns nothing, and
 * "nothing" reads as "not done yet" — so the season is set up again, and the
 * facts are laid over a draft somebody deliberately cleared. The comment in
 * playerFacts.js says exactly what that looks like: "Null out a player's pick,
 * reload, and the file puts it straight back."
 *
 * `openSetup()` is what should make the collection readable, and it returns a
 * resolved promise without loading anything. This pins the difference.
 */
const SEASON = 's_1';
const setupPath = (id) => `seasons/${id}/setup`;

let repo;
beforeEach(() => { repo = createRepository(createMemoryAdapter()); });

describe('a marker written by somebody else', () => {
    it('is invisible until the collection has been loaded', async () => {
        // Another client wrote it. This one has not read the collection yet.
        const other = createRepository(createMemoryAdapter());
        await other.ready(setupPath(SEASON));
        other.set(setupPath(SEASON), 'season', { at: 1 });

        // A synchronous read, which is how isInitialised and factsSeeded ask.
        expect(repo.get(setupPath(SEASON), 'season')).toBeNull();
    });

    it('is visible once the collection is loaded, which is what open() is for', async () => {
        repo.set(setupPath(SEASON), 'season', { at: 1 });
        await repo.ready(setupPath(SEASON));

        expect(repo.get(setupPath(SEASON), 'season')).toMatchObject({ at: 1 });
    });

    it('answers for a season nobody has set up', async () => {
        await repo.ready(setupPath(SEASON));
        expect(repo.get(setupPath(SEASON), 'season')).toBeNull();
        expect(repo.get(setupPath(SEASON), 'facts')).toBeNull();
    });

    it('keeps the two markers apart', async () => {
        await repo.ready(setupPath(SEASON));
        repo.set(setupPath(SEASON), 'facts', { at: 2 });

        expect(repo.get(setupPath(SEASON), 'facts')).toMatchObject({ at: 2 });
        expect(repo.get(setupPath(SEASON), 'season')).toBeNull();
    });

    it('keeps one season’s markers out of another’s', async () => {
        await Promise.all([repo.ready(setupPath('s_1')), repo.ready(setupPath('s_2'))]);
        repo.set(setupPath('s_1'), 'season', { at: 1 });

        expect(repo.get(setupPath('s_2'), 'season')).toBeNull();
    });
});
