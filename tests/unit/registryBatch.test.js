import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import { resolve, resolveAll, beginBatch, endBatch, loadRegistry, byId } from '../../src/utils/playerRegistry';

/**
 * One write for a whole import, not one per player.
 *
 * `resolveAll` commits once for a list, and the roster parser cannot use it: it
 * needs an id back while it is still parsing the line the name came from. So it
 * called `resolve()` per slot, and every call that created somebody rewrote the
 * WHOLE collection — measured at 83 rewrites of an 89KB key during boot, 0.55MB
 * of localStorage writes, for a 91-player roster.
 *
 * The lookups stay one at a time; the writes batch. What must not break is the
 * thing this module exists for: a player minted mid-batch has to be found by
 * the next lookup, or the import mints him again and two records claim one man.
 */
const PLAYERS = 'players';

beforeEach(async () => {
    repository.invalidate();
    await repository.ready(PLAYERS);
    const existing = repository.docs(PLAYERS) ?? {};
    const drop = Object.keys(existing).map(id => ({ id, doc: null }));
    if (drop.length) await repository.commit(PLAYERS, drop);
    endBatch();   // never leave one open between tests
});

describe('a batched import', () => {
    it('writes once for many players, not once each', async () => {
        const spy = vi.spyOn(repository, 'commit');

        beginBatch();
        ['Arvell Reese', 'Fernando Mendoza', 'Zane Durant', 'Diego Pounds'].forEach(
            name => resolve({ name, position: 'EDGE' }),
        );
        const writes = spy.mock.calls.filter(([c]) => c === PLAYERS).length;
        expect(writes).toBe(0);      // nothing written yet

        endBatch();
        expect(spy.mock.calls.filter(([c]) => c === PLAYERS).length).toBe(1);
        spy.mockRestore();
    });

    it('finds a player minted earlier in the same batch, rather than minting him twice', async () => {
        beginBatch();
        const first = resolve({ name: 'Arvell Reese', position: 'EDGE' });
        const again = resolve({ name: 'Arvell Reese', position: 'EDGE' });
        endBatch();

        expect(first).toBe(again);
        expect(loadRegistry().filter(p => p.name === 'Arvell Reese')).toHaveLength(1);
    });

    it('makes the records real once the batch closes', async () => {
        beginBatch();
        const id = resolve({ name: 'Tyquan Thornton', position: 'WR', school: 'Baylor' });
        endBatch();

        expect(byId(id)).toMatchObject({ name: 'Tyquan Thornton', position: 'WR' });
    });

    it('still matches against players already stored', async () => {
        const [existing] = resolveAll([{ name: 'Fernando Mendoza', position: 'QB' }]);

        beginBatch();
        const found = resolve({ name: 'Fernando Mendoza', position: 'QB' });
        endBatch();

        expect(found).toBe(existing);
    });

    it('writes nothing when a batch created nobody', async () => {
        const spy = vi.spyOn(repository, 'commit');
        beginBatch();
        endBatch();
        expect(spy.mock.calls.filter(([c]) => c === PLAYERS)).toHaveLength(0);
        spy.mockRestore();
    });

    it('recovers a batch a thrown caller left open, rather than losing the records', async () => {
        beginBatch();
        const id = resolve({ name: 'Somebody Interrupted', position: 'CB' });
        // No endBatch — the parser threw. The next import must not lose him.
        beginBatch();
        endBatch();

        expect(byId(id)).toMatchObject({ name: 'Somebody Interrupted' });
    });

    it('behaves exactly as before when no batch is open', async () => {
        const id = resolve({ name: 'Unbatched Player', position: 'TE' });
        expect(byId(id)).toMatchObject({ name: 'Unbatched Player' });
    });
});
