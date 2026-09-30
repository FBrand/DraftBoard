import { describe, it, expect, beforeEach } from 'vitest';
import { createOverlayAdapter } from '../../src/data/overlayAdapter';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * An expert who is not the lead keeps his draft to himself.
 *
 * The lead's picks reach the database and nobody else's do. Enforcing that in
 * `firestore.rules` would mean looking up who holds the lead on every one of
 * roughly three hundred pick writes, and it could not work anyway: a pick is a
 * fact on a PLAYER, and the players collection also carries names, schools and
 * matrix scores that an expert absolutely should publish. Same path, two kinds
 * of write, and only the caller can tell them apart.
 *
 * So the caller says so, with `{ mine: true }`, and the overlay honours it
 * ahead of asking whether this person may write remotely at all. These tests
 * exist because that is an easy thing to thread through four methods and get
 * silently wrong in one of them — and the failure is invisible: the write
 * succeeds, on screen it looks right, and another analyst's mock draft appears
 * on everybody's player cards.
 */
const PLAYERS = 'players';

let remote, local, adapter;

function localWithSync() {
    const base = createMemoryAdapter();
    return { ...base, loadSync: (path) => base.dump()[path] ?? {} };
}

beforeEach(() => {
    remote = createMemoryAdapter();
    local = localWithSync();
    // An EXPERT throughout: writesRemote says yes to everything. What is being
    // tested is the intent overriding the permission, not the permission.
    adapter = createOverlayAdapter({ remote, local, writesRemote: () => true });
});

const inRemote = async (path) => Object.keys(await remote.load(path));
const inLocal = async (path) => Object.keys(await local.load(path));

describe('a write marked as this person’s own', () => {
    it('stays local on set, while an unmarked one publishes', async () => {
        await adapter.set(PLAYERS, 'p_1', { n: 'Published' });
        await adapter.set(PLAYERS, 'p_2', { n: 'Private' }, { mine: true });

        expect(await inRemote(PLAYERS)).toEqual(['p_1']);
        expect(await inLocal(PLAYERS)).toContain('p_2');
    });

    it('stays local on commit, which is how a draft writes its picks', async () => {
        await adapter.commit(PLAYERS, [
            { id: 'p_3', doc: { draftPick: 4 } },
            { id: 'p_4', doc: { draftPick: 5 } },
        ], { mine: true });

        expect(await inRemote(PLAYERS)).toEqual([]);
        expect(await inLocal(PLAYERS)).toEqual(expect.arrayContaining(['p_3', 'p_4']));
    });

    it('stays local on commitMany, which spans collections', async () => {
        await adapter.commitMany([
            { path: PLAYERS, id: 'p_5', doc: { draftPick: 6 } },
            { path: 'draft_state', id: 's_1', doc: { value: { currentPick: 7 } } },
        ], { mine: true });

        expect(await inRemote(PLAYERS)).toEqual([]);
        expect(await inRemote('draft_state')).toEqual([]);
        expect(await inLocal(PLAYERS)).toContain('p_5');
    });

    it('stays local on remove, so unpicking does not reach across either', async () => {
        await adapter.set(PLAYERS, 'p_6', { n: 'Published' });
        expect(await inRemote(PLAYERS)).toContain('p_6');

        await adapter.remove(PLAYERS, 'p_6', { mine: true });

        // Still in the shared store: undoing a private pick is private too.
        expect(await inRemote(PLAYERS)).toContain('p_6');
    });

    it('does not change what an expert publishes when unmarked', async () => {
        // The other half. A rename or a school correction is exactly the same
        // collection, and must still reach everybody.
        await adapter.commit(PLAYERS, [{ id: 'p_7', doc: { n: 'Corrected Name' } }]);
        expect(await inRemote(PLAYERS)).toContain('p_7');
    });
});
