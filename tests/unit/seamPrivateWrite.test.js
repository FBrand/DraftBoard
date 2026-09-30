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
    it('reaches the adapter marked', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([{ collection: 'players', id: 'p_1', doc: { k: 4 }, mine: true }]);

        expect(calls).toHaveLength(1);
        expect(calls[0].mine).toBe(true);
    });

    it('is not marked when nothing asks', async () => {
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([{ collection: 'players', id: 'p_2', doc: { n: 'Corrected' } }]);

        expect(calls[0].mine).toBe(false);
    });

    it('is split from a publishable change in the same batch', async () => {
        // The failure a naive grouping produces: one call, one flag, and either
        // the pick is published or the correction is swallowed.
        const store = createStore(fromLegacyAdapter(adapter));
        await store.write([
            { collection: 'players', id: 'p_pick', doc: { k: 9 }, mine: true },
            { collection: 'players', id: 'p_fix', doc: { n: 'Corrected' } },
        ]);

        expect(calls).toHaveLength(2);
        const priv = calls.find(c => c.mine);
        const pub = calls.find(c => !c.mine);
        expect(priv.ids).toEqual(['p_pick']);
        expect(pub.ids).toEqual(['p_fix']);
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
