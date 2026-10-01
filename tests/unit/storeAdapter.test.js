import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStoreAdapter } from '../../src/data/storeAdapter';
import { fromLegacyAdapter } from '../../src/data/contract';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * The replacement for the overlay adapter, tested on the properties the overlay
 * was tested on.
 *
 * The overlay merged two stores — remote and local, local winning, with
 * tombstones so a deletion the local half remembers survives a read — and routed
 * a write to one or the other depending on whether this person's writes are
 * accepted. Those five test files are gone and this one stands in their place, so
 * what each of them asserted is listed here rather than implied:
 *
 *   overlayAdapter.test.js    a viewer's own work over the experts'; tombstones
 *   remoteReadFailure.test.js a failed read is not an empty collection
 *   liveUpdates.test.js       a pushed change arrives and does not clobber
 *   privateDraft.test.js      a write marked private is not published
 *   stampIsAField.test.js     a merge changes named fields and nothing else
 *
 * The replacement is not a merge of two anonymous halves: `shared` is what the
 * backend said, `mine` is this person's own work, `unsent` is issued and
 * unacknowledged, and refused work is a fourth state no read ever sees.
 */
const BOARD = 'boards/b_expert/entries';

let remote, adapter, signedIn, errors;

const build = () => {
    errors = [];
    adapter = createStoreAdapter(fromLegacyAdapter(remote), {
        canWrite: () => signedIn,
        onRemoteError: (path, err) => errors.push({ path, err }),
    });
};

beforeEach(() => {
    globalThis.resetStorage();
    remote = createMemoryAdapter();
    signedIn = false;
    build();
});

describe('a viewer’s own work over the experts’', () => {
    it('is what he reads back, while the shared copy is untouched', async () => {
        await remote.set(BOARD, 'p_1', { r: 1 });
        await adapter.load(BOARD);

        await adapter.set(BOARD, 'p_1', { r: 5 });

        expect((await adapter.load(BOARD)).p_1).toEqual({ r: 5 });
        // He did not write to the database — he wrote over it.
        expect((await remote.load(BOARD)).p_1).toEqual({ r: 1 });
    });

    it('includes a deletion, which a merge of two halves needs a tombstone for', async () => {
        await remote.set(BOARD, 'p_1', { r: 1 });
        await adapter.load(BOARD);

        await adapter.remove(BOARD, 'p_1');

        expect(await adapter.load(BOARD)).toEqual({});
        expect((await remote.load(BOARD)).p_1).toEqual({ r: 1 });
    });

    it('survives a reload, because a play-along that vanishes is not one', async () => {
        await adapter.set(BOARD, 'p_mine', { r: 9 });
        await new Promise(r => setTimeout(r, 0));   // the persist is coalesced to a tick
        build();   // same storage, new adapter

        expect((await adapter.load(BOARD)).p_mine).toEqual({ r: 9 });
    });
});

describe('an expert', () => {
    it('writes to the shared store', async () => {
        signedIn = true;
        await adapter.set(BOARD, 'p_2', { r: 2 });

        expect((await remote.load(BOARD)).p_2).toEqual({ r: 2 });
    });

    it('is asked on every write, not once', async () => {
        // Signing in happens while the app is running, and a captured answer kept
        // an expert writing locally for a whole session.
        await adapter.set(BOARD, 'p_before', { r: 1 });
        signedIn = true;
        await adapter.set(BOARD, 'p_after', { r: 2 });

        const shared = await remote.load(BOARD);
        expect(shared.p_before).toBeUndefined();
        expect(shared.p_after).toEqual({ r: 2 });
    });

    it('keeps a write marked private out of the shared store anyway', async () => {
        signedIn = true;
        await adapter.set(BOARD, 'p_pick', { r: 3 }, { mine: true });

        expect(await remote.load(BOARD)).toEqual({});
        expect((await adapter.load(BOARD)).p_pick).toEqual({ r: 3 });
    });
});

describe('a merge', () => {
    it('changes the fields it names and leaves the rest', async () => {
        signedIn = true;
        await adapter.set('boards', 'b_1', { l: 'Dan', o: 'dan-uid' });
        await adapter.commit('boards', [{ id: 'b_1', doc: { u: 42 }, merge: true }]);

        expect((await remote.load('boards')).b_1).toEqual({ l: 'Dan', o: 'dan-uid', u: 42 });
    });
});

describe('a read the store could not answer', () => {
    it('is reported, and answered from this person’s own work', async () => {
        const broken = {
            name: 'broken',
            async load() { throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); },
            async set() {}, async remove() {},
        };
        errors = [];
        const over = createStoreAdapter(fromLegacyAdapter(broken), {
            canWrite: () => false,
            onRemoteError: (path, err) => errors.push({ path, err }),
        });

        await over.set(BOARD, 'p_own', { r: 7 });
        const seen = await over.load(BOARD);

        // Reported rather than swallowed: "could not read" is not "nothing there".
        expect(errors).toHaveLength(1);
        expect(over.readFailed(BOARD)).toBe(true);
        // And he still sees his own board rather than a blank page.
        expect(seen.p_own).toEqual({ r: 7 });
    });
});

describe('a pushed change', () => {
    it('arrives, and does not overwrite what is mine', async () => {
        let push = null;
        const pushy = {
            name: 'pushy',
            async load() { return {}; },
            async set() {}, async remove() {},
            watch(path, onChange) { push = onChange; return () => { push = null; }; },
        };
        const live = createStoreAdapter(fromLegacyAdapter(pushy), { canWrite: () => false });

        const seen = vi.fn();
        const stop = live.watch(BOARD, seen);
        await live.set(BOARD, 'p_1', { r: 1 });     // mine
        push({ p_1: { r: 99 }, p_2: { r: 2 } });    // theirs

        expect(seen).toHaveBeenCalled();
        const merged = await live.load(BOARD);
        expect(merged.p_1).toEqual({ r: 1 });       // mine still wins
        expect(merged.p_2).toEqual({ r: 2 });       // and theirs arrived
        stop();
    });
});

describe('what it deliberately does not offer', () => {
    it('has no loadSync, because the only answer it could give is a wrong one', () => {
        // Its absence is the feature, and the overlay said so too: a synchronous
        // read can only answer from this person's own work, which for a viewer who
        // has changed nothing is an empty board returned instantly and
        // confidently. Worse than not answering.
        expect(adapter.loadSync).toBeUndefined();
    });
});
