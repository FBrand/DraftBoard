import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hydrateIfEmpty } from '../../src/data/hydrate';
import { createMemoryAdapter } from '../../src/data/memoryAdapter';

/**
 * Putting a pre-built snapshot into an empty local store — and refusing to, in
 * every other case.
 *
 * The seeder is not part of the app. It runs at build time and produces every
 * document the app needs; for a local-only build it writes them to a file, and
 * copying that file in is the app's entire involvement. Every decision that used
 * to live in the client — what a default board is, which players are in the
 * class, which names match which records — belongs to the seeder now.
 *
 * What these mostly test is the refusals, because the damage this project has
 * taken has always come from seeding something that was not empty, or seeding a
 * store shared with nine other people.
 */
const snapshot = {
    seededAt: '2026-09-30T00:00:00.000Z',
    season: { id: 's_1', year: 2026 },
    documents: 3,
    collections: {
        players: { p_1: { n: 'One' }, p_2: { n: 'Two' } },
        boards: { b_1: { g: 'consensus' } },
    },
};

const served = (body) => vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(body) }));
const missing = () => vi.fn(async () => ({ ok: false, status: 404 }));

let local;

beforeEach(() => {
    local = { ...createMemoryAdapter(), collections: undefined };
    // The memory adapter has collections(); give this one the same shape the
    // local adapter has, since that is what hydration asks.
    const base = createMemoryAdapter();
    local = { ...base, collections: () => base.collections() };
});

describe('hydrating an empty local store', () => {
    it('copies every collection in', async () => {
        const result = await hydrateIfEmpty(local, { fetch: served(snapshot) });

        expect(result.hydrated).toBe(true);
        expect(result.documents).toBe(3);
        expect(Object.keys(await local.load('players'))).toEqual(['p_1', 'p_2']);
        expect(Object.keys(await local.load('boards'))).toEqual(['b_1']);
    });

    it('does nothing at all the second time', async () => {
        await hydrateIfEmpty(local, { fetch: served(snapshot) });
        const again = await hydrateIfEmpty(local, { fetch: served(snapshot) });

        expect(again.hydrated).toBe(false);
        expect(again.reason).toMatch(/not empty/i);
    });

    it('refuses a shared store, whatever it holds', async () => {
        // A store that can be watched is shared: its data comes from the seeder
        // directly, and a snapshot fetched by a browser would be a second source
        // of truth for data ten people have in common.
        const shared = { ...createMemoryAdapter(), watch: () => () => {} };
        const result = await hydrateIfEmpty(shared, { fetch: served(snapshot) });

        expect(result.hydrated).toBe(false);
        expect(result.reason).toMatch(/shared/i);
        expect(Object.keys(await shared.load('players'))).toEqual([]);
    });

    it('refuses a store that holds anything at all, even one document', async () => {
        // One rule, not two. Filling the gaps in a partly-populated store was
        // the first version, and it cannot tell a hydration a closed tab
        // interrupted from somebody who cleared his boards on purpose — so it
        // would lay a snapshot's boards over a class he had since replaced,
        // giving him a store that matches neither.
        //
        // An interrupted hydration therefore leaves a half-seeded app, which is
        // visible and fixable, rather than a quietly mixed one.
        await local.set('players', 'p_mine', { n: 'Mine' });

        const result = await hydrateIfEmpty(local, { fetch: served(snapshot) });

        expect(result.hydrated).toBe(false);
        expect(result.reason).toMatch(/not empty/i);
        expect(Object.keys(await local.load('players'))).toEqual(['p_mine']);
        expect(Object.keys(await local.load('boards'))).toEqual([]);
    });

    it('is not an error when a build ships no snapshot', async () => {
        // The local-only app with nothing seeded is a legitimate build: it comes
        // up empty and somebody imports a class.
        const result = await hydrateIfEmpty(local, { fetch: missing() });

        expect(result.hydrated).toBe(false);
        expect(result.reason).toMatch(/no snapshot/i);
    });

    it('survives a snapshot that is not one', async () => {
        const result = await hydrateIfEmpty(local, { fetch: served({ nonsense: true }) });
        expect(result.hydrated).toBe(false);
        expect(result.reason).toMatch(/no collections/i);
    });
});
