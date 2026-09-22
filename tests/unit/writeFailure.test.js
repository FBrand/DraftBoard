import { describe, it, expect, beforeEach } from 'vitest';
import { createRepository } from '../../src/data/repository';

/**
 * Writes that do not land.
 *
 * The repository updates memory, notifies, and reaches the adapter after — the
 * right order for a UI that must not wait, and a lie if the write then fails.
 * Against localStorage it could only fail on a full quota, and the adapter
 * swallowed that: the app had already been told it worked, and the screen went
 * on showing a change that was never saved.
 *
 * Over a network it fails routinely — offline, a rule rejecting it, a timeout.
 * So the local change goes back and somebody is told.
 */
const adapterThat = ({ fail = false } = {}) => {
    const store = new Map();
    const boom = () => Promise.reject(new Error('write rejected'));
    return {
        name: 'test',
        async load(c) { return { ...(store.get(c) ?? {}) }; },
        loadSync(c) { return { ...(store.get(c) ?? {}) }; },
        async set(c, id, doc) {
            if (fail) return boom();
            store.set(c, { ...(store.get(c) ?? {}), [id]: doc });
        },
        async remove(c, id) {
            if (fail) return boom();
            const next = { ...(store.get(c) ?? {}) };
            delete next[id];
            store.set(c, next);
        },
        async commit(c, changes) {
            if (fail) return boom();
            const next = { ...(store.get(c) ?? {}) };
            changes.forEach(({ id, doc }) => { if (doc === null) delete next[id]; else next[id] = doc; });
            store.set(c, next);
        },
        seed(c, docs) { store.set(c, docs); },
    };
};

// The pending-write queue is persisted, so a repository picks up whatever the
// last one left behind. Tests have to start from an empty store or they read
// each other's unsaved work.
beforeEach(() => { globalThis.resetStorage(); });

describe('a write that succeeds', () => {
    it('is visible immediately, before the adapter has finished', async () => {
        const repo = createRepository(adapterThat());
        const pending = repo.set('players', 'p1', { name: 'Fernando Mendoza' });

        // The point of writing to memory first: no await before the UI updates.
        expect(repo.get('players', 'p1').name).toBe('Fernando Mendoza');
        await pending;
        expect(repo.get('players', 'p1').name).toBe('Fernando Mendoza');
    });
});

describe('a write that fails', () => {
    it('KEEPS the change rather than putting it back', async () => {
        // This is the opposite of what it used to do, on purpose. Rolling back
        // is honest about storage and terrible for the person: the work is
        // gone and the only notice is a message saying so. Offline is Tuesday.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { name: 'Still Here' });
        expect(repo.get('players', 'p1').name).toBe('Still Here');
    });

    it('parks it and says how many are waiting', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { name: 'x' });

        const sync = repo.syncState();
        expect(sync.state).toBe('retrying');
        expect(sync.pending).toBe(1);
    });

    it('keeps one pending write per document, not one per attempt', async () => {
        // A player dragged five times while offline is one pending write
        // holding the latest position, not five holding a history.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { name: 'one' });
        await repo.set('players', 'p1', { name: 'two' });
        await repo.set('players', 'p1', { name: 'three' });

        expect(repo.syncState().pending).toBe(1);
        expect(repo.get('players', 'p1').name).toBe('three');
    });

    it('lands the moment the store comes back', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.set = () => Promise.reject(new Error('offline'));

        await repo.set('players', 'p1', { name: 'Fernando Mendoza' });
        expect(repo.syncState().state).toBe('retrying');

        // The store recovers, and the queue is emptied by hand the way the
        // "Try again" button does it.
        const store = new Map();
        adapter.set = async (c, id, doc) => { store.set(id, doc); };
        await repo.retryNow();

        expect(repo.syncState().state).toBe('saved');
        expect(store.get('p1').name).toBe('Fernando Mendoza');
    });

    it('tells somebody, with enough to say what failed', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        const seen = [];
        repo.onWriteError(e => seen.push(e));

        await repo.set('players', 'p1', { name: 'x' });

        expect(seen[0].collection).toBe('players');
        expect(seen[0].id).toBe('p1');
        expect(seen[0].error.message).toBe('write rejected');
    });

    it('announces the sync state as it changes', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        const states = [];
        repo.onSyncChange(s => states.push(s.state));

        await repo.set('players', 'p1', { name: 'x' });

        expect(states[0]).toBe('saved');          // on subscribe
        expect(states).toContain('saving');
        expect(states[states.length - 1]).toBe('retrying');
    });

    it('stops listening when told to', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        const seen = [];
        const off = repo.onWriteError(e => seen.push(e));
        off();

        await repo.set('players', 'p1', { name: 'x' });
        expect(seen).toHaveLength(0);
    });
});

describe('a batch that fails', () => {
    it('keeps every document in it, and queues them one by one', async () => {
        // Individually, so one poisoned document cannot hold the rest hostage
        // for ever — the store may well take the others.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.commit('players', [
            { id: 'p1', doc: { name: 'One' } },
            { id: 'p2', doc: { name: 'Two' } },
        ]);

        expect(repo.get('players', 'p1').name).toBe('One');
        expect(repo.get('players', 'p2').name).toBe('Two');
        expect(repo.syncState().pending).toBe(2);
    });

    it('queues a deletion as a deletion', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.seed('players', { p1: { name: 'One' } });
        await repo.ready('players');

        adapter.commit = () => Promise.reject(new Error('offline'));
        await repo.commit('players', [{ id: 'p1', doc: null }]);

        expect(repo.get('players', 'p1')).toBeNull();
        expect(repo.syncState().pending).toBe(1);

        const removed = [];
        adapter.remove = async (c, id) => { removed.push(id); };
        await repo.retryNow();
        expect(removed).toEqual(['p1']);
    });
});

describe('knowing whether a collection can be read yet', () => {
    const remoteish = () => ({
        name: 'remote',
        async load() { return {}; },   // no loadSync, like a real remote adapter
        async set() {},
        async remove() {},
    });

    it('is always ready against a local adapter, which can read on the spot', () => {
        const repo = createRepository(adapterThat());
        expect(repo.isLoaded('players')).toBe(true);
    });

    it('is not ready against a remote one until it has been read', async () => {
        const repo = createRepository(remoteish());
        expect(repo.isLoaded('players')).toBe(false);

        await repo.ready('players');
        expect(repo.isLoaded('players')).toBe(true);
    });
});

/**
 * A queue in memory is a queue a reload throws away — and a reload is exactly
 * what somebody does when the app seems stuck.
 *
 * So it is written down, to localStorage, which is emphatically NOT the store
 * the write failed to reach and is therefore still there when that one is not.
 * This is the difference between "your change is being retried" and "your
 * change WAS being retried", and without it the promise of not losing work
 * lasts until the next refresh, which is not a promise.
 */
describe('unsaved work outliving the tab', () => {
    it('writes the queue down where a reload can find it', async () => {
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { id: 'p1', name: 'Not Saved Yet' });

        const saved = JSON.parse(localStorage.getItem('pending_writes_v1'));
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ collection: 'players', id: 'p1', op: 'set' });
    });

    it('picks it up again, and puts the change back on screen with it', async () => {
        const adapter = adapterThat({ fail: true });
        const first = createRepository(adapter);
        await first.set('players', 'p1', { id: 'p1', name: 'Not Saved Yet' });

        // A new visit: same storage, a repository that has never seen this.
        const second = createRepository(adapterThat({ fail: true }));
        expect(second.syncState()).toMatchObject({ state: 'retrying', pending: 1 });
        // Not just queued — visible. Retrying something the screen no longer
        // shows would be its own kind of lie.
        expect(second.get('players', 'p1').name).toBe('Not Saved Yet');
    });

    it('clears it once the write finally lands', async () => {
        const adapter = adapterThat();
        const repo = createRepository(adapter);
        adapter.set = () => Promise.reject(new Error('offline'));
        await repo.set('players', 'p1', { id: 'p1', name: 'Eventually' });
        expect(localStorage.getItem('pending_writes_v1')).toBeTruthy();

        adapter.set = async () => {};
        await repo.retryNow();

        expect(localStorage.getItem('pending_writes_v1')).toBeNull();
        expect(repo.syncState().state).toBe('saved');
    });

    it('survives a queue file that is nonsense rather than refusing to start', () => {
        localStorage.setItem('pending_writes_v1', 'not json at all');
        const repo = createRepository(adapterThat());
        expect(repo.syncState().state).toBe('saved');
    });
});

/**
 * A refusal the store will repeat stops immediately.
 *
 * The difference between "the connection is down" and "the store looked at
 * this and said no" is the difference between waiting and doing something
 * about it, and the queue used to hide it by retrying both.
 */
describe('a write the store will never take', () => {
    const refusing = (code) => ({
        name: 'refusing',
        async load() { return {}; },
        loadSync() { return {}; },
        async set() { throw Object.assign(new Error(code), { code }); },
        async remove() { throw Object.assign(new Error(code), { code }); },
    });

    it('goes straight to failed instead of spending five attempts', async () => {
        const repo = createRepository(refusing('permission-denied'));
        await repo.set('boards', 'b1', { id: 'b1', label: 'Not mine' });

        expect(repo.syncState().state).toBe('failed');
    });

    it('carries the advice, which is the half worth reading', async () => {
        const repo = createRepository(refusing('permission-denied'));
        await repo.set('boards', 'b1', { id: 'b1' });
        expect(repo.syncState().advice).toMatch(/Sign in|board of your own/);
    });

    it('still keeps the change — refused is not the same as discarded', async () => {
        const repo = createRepository(refusing('invalid-argument'));
        await repo.set('boards', 'b1', { id: 'b1', label: 'Still here' });
        expect(repo.get('boards', 'b1').label).toBe('Still here');
    });

    it('keeps retrying something that was merely unreachable', async () => {
        const repo = createRepository(refusing('unavailable'));
        await repo.set('boards', 'b1', { id: 'b1' });
        expect(repo.syncState().state).toBe('retrying');
    });

    it('tries again when asked by hand, because the world may have changed', async () => {
        // Signing in is exactly the thing that turns permission-denied into a
        // write that works, and it happens after the refusal.
        const adapter = refusing('permission-denied');
        const repo = createRepository(adapter);
        await repo.set('boards', 'b1', { id: 'b1', label: 'Mine now' });
        expect(repo.syncState().state).toBe('failed');

        const written = [];
        adapter.set = async (c, id, doc) => { written.push(doc.label); };
        await repo.retryNow();

        expect(written).toEqual(['Mine now']);
        expect(repo.syncState().state).toBe('saved');
    });
});

/**
 * The way out of a refusal that will never resolve.
 *
 * Keeping a refused write is right while there is any chance it lands, and
 * wrong forever after. The store has judged it, so "Try again" buys another
 * identical refusal — and until it leaves, withPending lays it over the
 * store's own answer on every read. Somebody opening a board that belongs to
 * another analyst was shown his own rejected copy of it, reload after reload,
 * with no way to get back to what the database actually held.
 */
describe('discarding writes the store will never take', () => {
    const refusing = () => ({
        name: 'refusing',
        async load() { return {}; },
        loadSync() { return {}; },
        async set() { throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); },
        async remove() { throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); },
    });

    it('empties the queue and says how many it threw away', async () => {
        const repo = createRepository(refusing());
        await repo.set('boards', 'b1', { id: 'b1' });
        await repo.set('boards', 'b2', { id: 'b2' });
        expect(repo.syncState()).toMatchObject({ state: 'failed', pending: 2 });

        expect(repo.discardPending()).toBe(2);
        expect(repo.syncState()).toMatchObject({ state: 'saved', pending: 0 });
    });

    it('takes it off disk too, or the next visit picks it straight back up', async () => {
        const repo = createRepository(refusing());
        await repo.set('boards', 'b1', { id: 'b1' });
        expect(localStorage.getItem('pending_writes_v1')).toBeTruthy();

        repo.discardPending();

        expect(localStorage.getItem('pending_writes_v1')).toBeNull();
        // The thing the whole feature is for: a fresh repository over the same
        // storage comes up clean rather than resuming the refusal.
        expect(createRepository(refusing()).syncState().state).toBe('saved');
    });

    it('stops laying the refused write over what the store says', async () => {
        const adapter = refusing();
        const repo = createRepository(adapter);
        await repo.ready('boards');
        await repo.set('boards', 'b1', { id: 'b1', label: 'My rejected copy' });
        // Refused, and still winning the read — this is the bug.
        expect(repo.get('boards', 'b1').label).toBe('My rejected copy');

        repo.discardPending();

        // The cache still holds it, which is why the UI reloads after this;
        // what matters here is that the QUEUE no longer forces it back on top
        // of whatever the store returns.
        const reloaded = createRepository(adapter);
        await reloaded.ready('boards');
        expect(reloaded.get('boards', 'b1')).toBeNull();
    });

    it('does nothing, and says so, when there is nothing to discard', () => {
        const repo = createRepository(adapterThat());
        expect(repo.discardPending()).toBe(0);
        expect(repo.syncState().state).toBe('saved');
    });

    it('leaves a merely unreachable write alone — that one is still coming', async () => {
        // Guard against the button ever being offered in the retrying state:
        // discarding here would lose work that was never actually lost.
        const repo = createRepository(adapterThat({ fail: true }));
        await repo.set('players', 'p1', { id: 'p1', name: 'Coming Back' });
        expect(repo.syncState().state).toBe('retrying');
    });
});
