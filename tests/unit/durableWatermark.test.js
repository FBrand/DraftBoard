import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/data/store';

/**
 * The watermark survives a reload, or the delta buys nothing.
 *
 * A read can ask "what changed since this point". Held only in memory, the point
 * is lost on every reload — so every reload is a cold read of everything, which
 * is precisely the case that matters: an expert reloading a page that looks stuck
 * mid-broadcast, against a metered store. The plan puts the difference at roughly
 * 3,000 reads a day against 30.
 *
 * What must NOT be persisted is just as load-bearing. Documents restored beside a
 * watermark would be a cache claiming to be current; `answered` restored across a
 * reload would tell a caller the store has spoken when it has not, which is the
 * mistake that convinced seeding an empty project was already seeded.
 */
const backendOver = (log) => ({
    name: 'countable',
    capabilities: { push: false, sync: false, refuses: false, shared: true },
    async read(collection, opts) {
        log.push({ collection, since: opts?.since ?? null });
        return {
            docs: { d_1: { v: 1 } },
            removed: [],
            watermark: `w${log.length}`,
            complete: !opts?.since,
        };
    },
    async write() { return []; },
});

beforeEach(() => { globalThis.resetStorage(); });

describe('a watermark', () => {
    it('is asked for on the first read and sent back on the next', async () => {
        const log = [];
        const store = createStore(backendOver(log));

        await store.ready('players');
        await store.ready('players');   // forced by forget? no — same store

        expect(log[0].since).toBeNull();
    });

    it('survives a new store over the same storage, which is what a reload is', async () => {
        const first = [];
        await createStore(backendOver(first)).ready('players');
        expect(first[0].since).toBeNull();

        // A reload: new store, same browser, empty cache.
        const second = [];
        const reloaded = createStore(backendOver(second));
        await reloaded.ready('players');

        expect(second[0].since).toBe('w1');
    });

    it('does not restore the documents, only the point', async () => {
        const log = [];
        await createStore(backendOver(log)).ready('players');

        const reloaded = createStore(backendOver(log));
        // Nothing yet: a cache that came back with the watermark would be a
        // cache presenting itself as current.
        expect(reloaded.shared('players')).toBeNull();
    });

    it('does not restore "the store has answered"', async () => {
        const log = [];
        await createStore(backendOver(log)).ready('players');

        const reloaded = createStore(backendOver(log));
        // The distinction that matters: this store has not spoken to anybody
        // yet. Reading the restored watermark as an answer is how an unreachable
        // collection gets taken for an empty one.
        expect(reloaded.readiness('players').answered).toBe(false);
        expect(reloaded.readiness('players').since).toBe('w1');
    });

    it('goes when the collection is forgotten, so a point never outlives its data', async () => {
        const log = [];
        const store = createStore(backendOver(log));
        await store.ready('players');
        store.forget('players');

        const reloaded = createStore(backendOver(log));
        await reloaded.ready('players');

        // A full read again. Keeping the watermark would have asked for what
        // changed since then and rebuilt the collection from a few recent
        // changes.
        expect(log[log.length - 1].since).toBeNull();
    });
});
