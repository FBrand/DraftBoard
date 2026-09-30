import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createOverlayAdapter } from '../../src/data/overlayAdapter';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * Changing one field must not write back every field you were holding.
 *
 * `writeEntries` stamps the board document when a board's placements change, so
 * another device can decide whether its cached 328 entries are worth
 * re-reading. It used to do that by reassembling the board from its own cache —
 * `{ ...board, u: Date.now() }` — and writing the whole record back.
 *
 * Everything stale in that cache went with it, and one of those fields is
 * OWNERSHIP: the field firestore.rules reads to decide whether the write is
 * allowed at all. An expert whose cached copy predated a claim, a release or a
 * revocation wrote a stale owner back, the rules refused it, and the refusal
 * took the 328 entries batched alongside — a whole board's work lost to a
 * marker nobody reads directly.
 *
 * So the stamp is a MERGE: the fields named, and nothing else. These tests are
 * at the adapter level because that is where the difference is real — a merge
 * that quietly behaves like a set passes every test written against the caller.
 */
const BOARDS = 'boards';

let remote, local, adapter;

beforeEach(() => {
    remote = createMemoryAdapter();
    local = { ...createMemoryAdapter() };
    adapter = createOverlayAdapter({ remote, local, writesRemote: () => false });
});

describe('a merge item', () => {
    it('leaves fields it does not name alone', async () => {
        await local.set(BOARDS, 'b_1', { l: 'Dan', o: 'dan-uid', a: 'a_dan' });

        await adapter.commitMany([
            { path: BOARDS, id: 'b_1', doc: { u: 1234 }, merge: true },
        ]);

        const after = (await local.load(BOARDS)).b_1;
        expect(after).toEqual({ l: 'Dan', o: 'dan-uid', a: 'a_dan', u: 1234 });
    });

    it('merges against what is STORED, not against a caller’s copy', async () => {
        // The scenario that cost the board. The writer's cache says he owns it;
        // the store says somebody else claimed it since. A set would put his
        // stale owner back. A merge cannot, because it never mentions the field.
        await local.set(BOARDS, 'b_1', { l: 'Dan', o: 'ryan-uid' });

        await adapter.commitMany([
            { path: BOARDS, id: 'b_1', doc: { u: 9999 }, merge: true },
        ]);

        expect((await local.load(BOARDS)).b_1.o).toBe('ryan-uid');
    });

    it('still replaces the document when nothing says merge', async () => {
        // The other half: an ordinary write is still a write, or every caller
        // that means to replace a record would silently start accumulating.
        await local.set(BOARDS, 'b_1', { l: 'Dan', o: 'dan-uid' });

        await adapter.commitMany([
            { path: BOARDS, id: 'b_1', doc: { l: 'Renamed' } },
        ]);

        expect((await local.load(BOARDS)).b_1).toEqual({ l: 'Renamed' });
    });

    it('reaches a remote store as a merge rather than a replacement', async () => {
        const spy = vi.fn(async () => {});
        const remoteWithSpy = { ...createMemoryAdapter(), commitMany: spy };
        const live = createOverlayAdapter({ remote: remoteWithSpy, local, writesRemote: () => true });

        await live.commitMany([{ path: BOARDS, id: 'b_1', doc: { u: 5 }, merge: true }]);

        // The flag has to survive the trip, or the adapter underneath replaces
        // the document and the whole exercise is undone one layer down.
        expect(spy).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ merge: true })]),
        );
    });
});
