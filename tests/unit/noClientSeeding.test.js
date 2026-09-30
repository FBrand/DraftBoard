import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards, allBoards, listSeasons } from '../../src/utils/boardRegistry';

/**
 * The app does not seed. Not on a shared backend, not on a local one, not at all.
 *
 * This file used to test a GATE: `openBoards()` seeded unless the backend was
 * live, and the tests proved the gate held. That was the wrong shape and the
 * audit said so — the function that decided the store was empty also wrote the
 * defaults into it, and every silent-overwrite bug here came out of that pairing.
 * A gate multiplies the sites instead of removing them, and a gate is what gets
 * forgotten.
 *
 * There is no gate now, and nothing to forget. `openBoards()` is a loader.
 * Seeding belongs to the seeder (`scripts/seed/`), which runs at build time and
 * is not shipped; a local store is filled from what it produced
 * (`data/hydrate.js`) before anything renders.
 *
 * So these assert an absence, which is a weak kind of test — a loader that
 * quietly regained a write would still pass a test about boards. They assert on
 * the WRITES instead: nothing reaches the store at all.
 */
beforeEach(() => {
    globalThis.resetStorage();
    repository.invalidate();
});

describe('openBoards', () => {
    it('writes nothing whatsoever', async () => {
        const set = vi.spyOn(repository, 'set');
        const commit = vi.spyOn(repository, 'commit');
        const commitMany = vi.spyOn(repository, 'commitMany');

        await openBoards();

        expect(set).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(commitMany).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it('comes up with nothing when nothing has been seeded', async () => {
        await openBoards();
        expect(allBoards()).toHaveLength(0);
        expect(listSeasons()).toHaveLength(0);
    });

    it('is the same on a live backend, with no condition deciding it', async () => {
        // The old version returned early for a live backend. Now there is no
        // branch at all, which is the point: a shared project that is empty stays
        // visibly empty rather than being papered over differently by every
        // client that loads it.
        vi.spyOn(repository, 'isLive').mockReturnValue(true);
        const set = vi.spyOn(repository, 'set');

        await openBoards();

        expect(set).not.toHaveBeenCalled();
        expect(allBoards()).toHaveLength(0);
        vi.restoreAllMocks();
    });

    it('still loads what somebody else put there', async () => {
        // A loader has to load, or this file is passing for the wrong reason.
        const { seedApp } = await import('./seedForTests');
        await seedApp();
        expect(allBoards().length).toBeGreaterThan(0);
        expect(listSeasons()).toHaveLength(1);
    });
});
