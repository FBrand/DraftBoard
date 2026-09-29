import { describe, it, expect } from 'vitest';
import { verifyBackend, requireBackend, fromLegacyAdapter, DOC_VERSION } from '../../src/data/contract';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';
import { localAdapter } from '../../src/data/localAdapter';

/**
 * The contract exists because the old one was a set of guesses.
 *
 * types.js named seven things; the app depended on seven more, every one of
 * them consumed by asking whether a method happened to exist. These tests are
 * about the two properties that fixes: a backend states what it can do, and a
 * claim it cannot honour is caught when it is built rather than when some
 * caller three layers up quietly gets nothing.
 */
const sound = () => ({
    name: 'sound',
    capabilities: { push: false, sync: false, refuses: false, shared: false },
    async read() { return { docs: {}, removed: [], watermark: '0', complete: true }; },
    async write(changes) { return changes.map(c => ({ collection: c.collection, id: c.id, outcome: 'stored' })); },
});

describe('what a backend has to declare', () => {
    it('accepts one that satisfies the contract', () => {
        expect(verifyBackend(sound())).toEqual([]);
    });

    it('names every missing piece at once, rather than the first', () => {
        const problems = verifyBackend({ name: 'half' });
        expect(problems).toContain('missing capabilities');
        expect(problems).toContain('missing read');
        expect(problems).toContain('missing write');
    });

    it('refuses a capability left undeclared', () => {
        const b = sound();
        delete b.capabilities.refuses;
        expect(verifyBackend(b)).toContain('capabilities.refuses must be declared');
    });

    it('refuses a claim the backend cannot honour', () => {
        // The failure the old arrangement could not have: claiming to do
        // something, and being believed, because nobody checked.
        const claimsSync = { ...sound(), capabilities: { push: false, sync: true, refuses: false, shared: false } };
        expect(verifyBackend(claimsSync)).toContain('claims sync but has no readSync');

        const claimsPush = { ...sound(), capabilities: { push: true, sync: false, refuses: false, shared: false } };
        expect(verifyBackend(claimsPush)).toContain('claims push but has no watch');
    });

    it('throws at construction, with the backend named', () => {
        expect(() => requireBackend({ name: 'broken' }))
            .toThrow(/Backend "broken" does not satisfy the storage contract/);
    });
});

describe('an old adapter presented through the contract', () => {
    it('declares what it can actually do, rather than being probed', () => {
        const memory = fromLegacyAdapter(createMemoryAdapter());
        // memoryAdapter has no loadSync and says so in its own header; that
        // absence is the feature, and it is now a declaration.
        expect(memory.capabilities.sync).toBe(false);
        expect(memory.capabilities.push).toBe(false);

        const local = fromLegacyAdapter(localAdapter);
        expect(local.capabilities.sync).toBe(true);
    });

    it('answers a read in the new shape', async () => {
        const b = fromLegacyAdapter(createMemoryAdapter());
        await b.write([{ collection: 'players', id: 'p1', doc: { n: 'Fernando Mendoza' } }]);
        const r = await b.read('players');

        expect(r.docs.p1.n).toBe('Fernando Mendoza');
        expect(r.removed).toEqual([]);
        expect(r.complete).toBe(true);
        expect(r.watermark).toEqual(expect.any(String));
    });

    it('reports the fate of every change, not just that the batch threw', async () => {
        const b = fromLegacyAdapter(createMemoryAdapter());
        const out = await b.write([
            { collection: 'players', id: 'p1', doc: { n: 'A' } },
            { collection: 'boards', id: 'b1', doc: { l: 'Consensus' } },
        ]);
        expect(out).toHaveLength(2);
        expect(out.every(r => r.outcome === 'stored')).toBe(true);
    });

    it('calls a failed write unreached, never refused', async () => {
        // The distinction the whole precedence model turns on. An old adapter
        // cannot tell them apart, so it must claim the recoverable one —
        // saying "refused" would strand work that was merely unsent.
        const failing = createMemoryAdapter({ failWrites: true });
        const b = fromLegacyAdapter(failing);
        const [result] = await b.write([{ collection: 'players', id: 'p1', doc: { n: 'A' } }]);

        expect(result.outcome).toBe('unreached');
        expect(result.error).toBeInstanceOf(Error);
    });

    it('accepts `since` and is honest that it ignored it', async () => {
        const b = fromLegacyAdapter(createMemoryAdapter());
        await b.write([{ collection: 'players', id: 'p1', doc: { n: 'A' } }]);
        const r = await b.read('players', { since: '12345' });

        // complete: true is the honesty. A wrapped adapter cannot do deltas,
        // so it returns everything and says so, rather than letting a caller
        // believe it received only what changed.
        expect(r.complete).toBe(true);
        expect(Object.keys(r.docs)).toEqual(['p1']);
    });
});

describe('documents carry a version', () => {
    it('from the start, while there is nothing to migrate', () => {
        expect(DOC_VERSION).toBe(1);
    });
});
