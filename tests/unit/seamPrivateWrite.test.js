import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fromLegacyAdapter } from '../../src/data/contract';
import { createStore } from '../../src/data/store';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * The newer seam can say "this write is mine alone".
 *
 * This is the capability the audit named as the reason both seams still exist
 * (R8): the overlay adapter honours a `{ mine: true }` write, the layered store
 * had no way to ask for one, and a collection cannot move onto the newer seam
 * until it can — the draft's picks would start reaching the shared store the day
 * `players` moved across.
 *
 * The part that needs testing is the GROUPING, not the flag. The adapter takes
 * one option for a whole `commit`, so a batch holding both a private change and a
 * publishable one has to be split — and a naive implementation groups by
 * collection alone, sends the lot with one flag, and either publishes a private
 * pick or privately swallows a correction everybody needed.
 */
let adapter, calls;

beforeEach(() => {
    const base = createMemoryAdapter();
    calls = [];
    adapter = {
        ...base,
        commit: vi.fn(async (path, changes, opts) => {
            calls.push({ path, ids: changes.map(c => c.id), mine: !!opts?.mine });
            return base.commit(path, changes);
        }),
    };
});

describe('a private change through the layered store', () => {
    it('never reaches the adapter at all', async () => {
        // Stronger than it used to be. The flag was first threaded THROUGH to an
        // adapter that understood it, which is what the overlay needed. The
        // layered store does not need to send it anywhere: a write that may not
        // be published is this person's own work, so it goes to `mine` and stays
        // there. Nothing to mark, nothing to forward, nothing to get wrong one
        // layer down.
        const store = createStore(fromLegacyAdapter(adapter));
        const results = await store.write([{ collection: 'players', id: 'p_1', doc: { k: 4 }, mine: true }]);

        expect(calls).toHaveLength(0);
        expect(store.view('players').p_1).toEqual({ k: 4 });
        expect(results[0].outcome).toBe('stored');
    });

    it('is not marked when nothing asks', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([{ collection: 'players', id: 'p_2', doc: { n: 'Corrected' } }]);

        expect(calls[0].mine).toBe(false);
    });

    it('is split from a publishable change in the same batch', async () => {
        // A batch may hold both, and they go to different places: the pick to
        // `mine`, the correction to the store. Sending them together is how a
        // private pick gets published or a correction everybody needed gets
        // swallowed.
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([
            { collection: 'players', id: 'p_pick', doc: { k: 9 }, mine: true },
            { collection: 'players', id: 'p_fix', doc: { n: 'Corrected' } },
        ]);

        // Only the correction travelled.
        expect(calls).toHaveLength(1);
        expect(calls[0].ids).toEqual(['p_fix']);
        // And both are visible, which is the point of a layer rather than a flag.
        expect(store.view('players').p_pick).toEqual({ k: 9 });
        expect(store.view('players').p_fix).toEqual({ n: 'Corrected' });
    });

    it('still reports an outcome per change, whichever side it went', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        const results = await store.write([
            { collection: 'players', id: 'p_a', doc: { k: 1 }, mine: true },
            { collection: 'boards', id: 'b_1', doc: { l: 'Dan' } },
        ]);

        expect(results).toHaveLength(2);
        expect(results.every(r => r.outcome === 'stored')).toBe(true);
    });
});

/**
 * A merge through the layered store, which the board's change marker needs.
 *
 * `boardEntries` stamps a board when its placements change, and it must name that
 * one field: reassembling the record from cache writes back every stale field the
 * caller holds, including OWNERSHIP, which the rules read — and a refusal there
 * takes the 328 entries batched with it.
 *
 * Two places have to honour it or the caches diverge. `view()` while the write is
 * in flight, so the screen shows the document it will become rather than the
 * handful of fields; and the shared layer on acknowledge, applied the same way the
 * backend applies it.
 */
describe('a merge change', () => {
    it('shows the whole document while it is still in flight', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([{ collection: 'boards', id: 'b_1', doc: { l: 'Dan', o: 'dan-uid' } }]);

        // Never awaited, so it is still unacknowledged when view() is asked.
        store.write([{ collection: 'boards', id: 'b_1', doc: { u: 42 }, merge: true }]);

        expect(store.view('boards').b_1).toEqual({ l: 'Dan', o: 'dan-uid', u: 42 });
    });

    it('leaves the other fields alone once it lands', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([{ collection: 'boards', id: 'b_2', doc: { l: 'Ryan', o: 'ryan-uid' } }]);
        await store.write([{ collection: 'boards', id: 'b_2', doc: { u: 7 }, merge: true }]);

        // The shared layer, not the merge of the layers: this is the copy a later
        // read has to agree with.
        expect(store.shared('boards').b_2).toEqual({ l: 'Ryan', o: 'ryan-uid', u: 7 });
    });

    it('still replaces the document when nothing says merge', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([{ collection: 'boards', id: 'b_3', doc: { l: 'Old', o: 'x' } }]);
        await store.write([{ collection: 'boards', id: 'b_3', doc: { l: 'New' } }]);

        expect(store.shared('boards').b_3).toEqual({ l: 'New' });
    });
});
