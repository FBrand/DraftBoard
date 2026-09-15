import { describe, it, expect, beforeEach } from 'vitest';
import { createOverlayAdapter, isTombstone } from '../../src/data/overlayAdapter';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * A viewer's own work over the experts'.
 *
 * The question this answers is the one that looked awkward: a viewer must be
 * able to build a board, reorder a roster and run a mock, while having no
 * write access at all to the database those live in. He does not write to it —
 * he writes over it.
 *
 * The local half here is a memory adapter rather than localStorage, because
 * what is being tested is the merge and the routing, not where the browser
 * keeps things.
 */
const BOARD = 'boards/b_expert/entries';

let remote, local, signedIn, adapter;

/** A local adapter with the synchronous read localStorage really has. */
function localWithSync() {
    const base = createMemoryAdapter();
    return { ...base, loadSync: (path) => base.dump()[path] ?? {} };
}

beforeEach(() => {
    remote = createMemoryAdapter();
    local = localWithSync();
    signedIn = false;
    adapter = createOverlayAdapter({
        remote, local, writesRemote: () => signedIn,
    });
});

const expertBoard = () => remote.commit(BOARD, [
    { id: 'p_mendoza', doc: { position: 'QB', round: 1, withinGroup: 1 } },
    { id: 'p_reese', doc: { position: 'EDGE', round: 1, withinGroup: 2 } },
    { id: 'p_downs', doc: { position: 'S', round: 2, withinGroup: 1 } },
]);

describe('a viewer', () => {
    it('sees the expert board he has never touched', async () => {
        await expertBoard();
        const docs = await adapter.load(BOARD);
        expect(Object.keys(docs).sort()).toEqual(['p_downs', 'p_mendoza', 'p_reese']);
        expect(docs.p_mendoza.round).toBe(1);
    });

    it('moving a player changes his copy and not the expert’s', async () => {
        await expertBoard();
        await adapter.set(BOARD, 'p_mendoza', { position: 'QB', round: 4, withinGroup: 1 });

        expect((await adapter.load(BOARD)).p_mendoza.round).toBe(4);
        // The published board is untouched — this is the whole point.
        expect((await remote.load(BOARD)).p_mendoza.round).toBe(1);
        expect(remote.dump()[BOARD].p_mendoza.round).toBe(1);
    });

    it('overlays only what he touched, keeping the rest of the expert’s board', async () => {
        await expertBoard();
        await adapter.set(BOARD, 'p_mendoza', { position: 'QB', round: 4 });

        const docs = await adapter.load(BOARD);
        expect(docs.p_mendoza.round).toBe(4);
        expect(docs.p_reese.round).toBe(1);
        expect(docs.p_downs.round).toBe(2);
    });

    it('can add a player of his own, which nobody else sees', async () => {
        await expertBoard();
        await adapter.set(BOARD, 'p_mine', { position: 'RB', round: 3 });

        expect(Object.keys(await adapter.load(BOARD))).toContain('p_mine');
        expect(Object.keys(await remote.load(BOARD))).not.toContain('p_mine');
    });

    it('never asks the database, so the rules never have to refuse him', async () => {
        // A permission error on every keystroke is the failure mode this
        // avoids. The rules still refuse him; he is simply never refused.
        const refusing = {
            ...createMemoryAdapter(),
            set: async () => { throw new Error('PERMISSION_DENIED'); },
            commit: async () => { throw new Error('PERMISSION_DENIED'); },
            remove: async () => { throw new Error('PERMISSION_DENIED'); },
        };
        const a = createOverlayAdapter({ remote: refusing, local, writesRemote: () => false });
        await expect(a.set(BOARD, 'p1', { round: 1 })).resolves.not.toThrow();
    });
});

describe('deleting something he does not own', () => {
    it('makes it go away for him and stay for everybody else', async () => {
        await expertBoard();
        await adapter.remove(BOARD, 'p_reese');

        expect(Object.keys(await adapter.load(BOARD)).sort()).toEqual(['p_downs', 'p_mendoza']);
        expect(Object.keys(await remote.load(BOARD))).toContain('p_reese');
    });

    it('is a tombstone, because a blank document is still a document', async () => {
        await expertBoard();
        await adapter.remove(BOARD, 'p_reese');
        expect(isTombstone(local.dump()[BOARD].p_reese)).toBe(true);
    });

    it('stays deleted across a reload, instead of the remote copy coming back', async () => {
        // Dropping the local copy rather than tombstoning would silently undo
        // the deletion on the very next read — the most confusing outcome
        // available.
        await expertBoard();
        await adapter.remove(BOARD, 'p_reese');
        const reloaded = createOverlayAdapter({ remote, local, writesRemote: () => false });
        expect(Object.keys(await reloaded.load(BOARD))).not.toContain('p_reese');
    });

    it('deletes in a batch the same way', async () => {
        await expertBoard();
        await adapter.commit(BOARD, [
            { id: 'p_reese', doc: null },
            { id: 'p_downs', doc: { position: 'S', round: 5 } },
        ]);

        const docs = await adapter.load(BOARD);
        expect(docs.p_reese).toBeUndefined();
        expect(docs.p_downs.round).toBe(5);
        expect(Object.keys(await remote.load(BOARD))).toContain('p_reese');
    });
});

describe('an expert', () => {
    beforeEach(() => { signedIn = true; });

    it('writes to the shared store, because his board is the published thing', async () => {
        await expertBoard();
        await adapter.set(BOARD, 'p_mendoza', { position: 'QB', round: 2 });

        expect((await remote.load(BOARD)).p_mendoza.round).toBe(2);
        expect(local.dump()[BOARD]).toBeUndefined();
    });

    it('really deletes, rather than hiding it from himself', async () => {
        await expertBoard();
        await adapter.remove(BOARD, 'p_reese');
        expect(Object.keys(await remote.load(BOARD))).not.toContain('p_reese');
    });

    it('commits a batch remotely', async () => {
        await adapter.commit(BOARD, [{ id: 'p1', doc: { round: 1 } }, { id: 'p2', doc: { round: 2 } }]);
        expect(Object.keys(await remote.load(BOARD)).sort()).toEqual(['p1', 'p2']);
    });
});

describe('starting over', () => {
    it('drops the viewer’s overlay and leaves the experts’ boards standing', async () => {
        await expertBoard();
        await adapter.set(BOARD, 'p_mendoza', { position: 'QB', round: 7 });
        await adapter.remove(BOARD, 'p_downs');

        await adapter.clear(BOARD);

        // Back to exactly what the expert published — including the player the
        // viewer had deleted, because a clean slate should not remember that.
        const docs = await adapter.load(BOARD);
        expect(Object.keys(docs).sort()).toEqual(['p_downs', 'p_mendoza', 'p_reese']);
        expect(docs.p_mendoza.round).toBe(1);
    });
});

describe('when the shared store is unreachable', () => {
    it('still shows the viewer his own work rather than nothing', async () => {
        const broken = {
            ...createMemoryAdapter(),
            load: async () => { throw new Error('offline'); },
        };
        const seen = [];
        const a = createOverlayAdapter({
            remote: broken, local, writesRemote: () => false,
            onRemoteError: (path, err) => seen.push([path, err.message]),
        });

        await a.set(BOARD, 'p_mine', { position: 'RB', round: 3 });
        const docs = await a.load(BOARD);

        expect(Object.keys(docs)).toEqual(['p_mine']);
        expect(seen).toEqual([[BOARD, 'offline']]);
    });
});

describe('the deliberate omission', () => {
    it('has no loadSync, even though the local half has one', () => {
        // Answering from the overlay alone would hand back an empty board for
        // a viewer who has changed nothing — instantly, and confidently.
        expect(adapter.loadSync).toBeUndefined();
        expect(local.loadSync).toBeTypeOf('function');
    });
});
