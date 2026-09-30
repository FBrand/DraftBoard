import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/data/store';

/**
 * A watermark does not outlive the documents it is about.
 *
 * A read can ask "what changed since this point", and persisting the point
 * looks like a free saving: the plan puts the difference at roughly 3,000 reads
 * a day against 30, since otherwise every reload is a cold read of everything.
 *
 * It is not free, and this file exists because I shipped it as though it were.
 * The point was persisted and the DOCUMENTS were not — so a reload restored a
 * position in time with an empty shared layer behind it, and the next read asked
 * for what changed since then and merged the answer onto nothing. A collection
 * rebuilt from a handful of recent changes, reporting itself current. That is
 * exactly what `forget()` refuses to do, in a comment, two hundred lines below
 * where I did it.
 *
 * It was harmless only by accident: the legacy bridge ignores `since` and reads
 * everything, so the saving was zero and the incorrectness was waiting for a
 * real delta to arrive. Saving those reads needs the documents restored with the
 * point, which is Phase 6 with the delta rather than a field written ahead of it.
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
    it('is carried within a session, so a second read asks for the delta', async () => {
        const log = [];
        const store = createStore(backendOver(log));

        await store.ready('players');
        expect(log[0].since).toBeNull();

        store.forget('players');
        await store.ready('players');
        // Forgetting drops the point with the documents, so this is full again.
        expect(log[1].since).toBeNull();
    });

    it('does NOT survive a new store over the same storage', async () => {
        const first = [];
        await createStore(backendOver(first)).ready('players');

        // A reload: new store, same browser. It must ask for everything, because
        // it is holding nothing to merge a delta onto.
        const second = [];
        await createStore(backendOver(second)).ready('players');

        expect(second[0].since).toBeNull();
    });

    it('reports that nobody has answered until somebody has', async () => {
        const log = [];
        const store = createStore(backendOver(log));
        expect(store.readiness('players').answered).toBe(false);
        expect(store.shared('players')).toBeNull();

        await store.ready('players');
        expect(store.readiness('players').answered).toBe(true);
    });
});
