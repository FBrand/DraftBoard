import { describe, it, expect, beforeEach } from 'vitest';
import {
    storageUsage, seasonKeys, seasonFootprint, reachablePlayerIds,
    addFiller, clearFiller, FILLER_KEY, oldestEvictable, evictSeason,
} from '../../src/utils/seasonStorage';

/**
 * Measuring what is held, and who is still spoken for.
 *
 * The reachability half is the dangerous one. Everywhere else in this app a
 * wrong answer mislabels something; here it deletes a player who is still
 * referenced and leaves the slot pointing at nothing. So it is set membership
 * on ids — never a name match — and a slot that has no id is counted as a
 * refusal to answer rather than as "nobody".
 */
const put = (key, value) => localStorage.setItem(key, JSON.stringify(value));

beforeEach(() => { globalThis.resetStorage(); });

describe('what is held', () => {
    it('counts key and value, the way the browser charges for them', () => {
        localStorage.setItem('db_a', '12345');
        const { bytes, keys } = storageUsage();
        expect(keys).toBe(1);
        expect(bytes).toBe('db_a'.length + 5);
    });

    it('reports the biggest keys first, which is what a report wants', () => {
        localStorage.setItem('db_small', 'x');
        localStorage.setItem('db_big', 'x'.repeat(500));
        expect(storageUsage().byKey[0].key).toBe('db_big');
    });
});

describe('what a season owns', () => {
    beforeEach(() => {
        put('db_seasons/s1/charts/rosterState/rows', { r1: {} });
        put('db_seasons/s1/setup', { season: {} });
        put('db_seasons/s2/charts/rosterState/rows', { r1: {} });
        put('db_boards/b1/entries', { p_one: {} });
        put('db_boards/b9/entries', { p_two: {} });
        put('db_players', { p_one: {}, p_two: {} });
    });

    it('takes its charts, its setup and its own boards — and nothing else', () => {
        const keys = seasonKeys('s1', ['b1']).sort();
        expect(keys).toEqual([
            'db_boards/b1/entries',
            'db_seasons/s1/charts/rosterState/rows',
            'db_seasons/s1/setup',
        ]);
    });

    it('never counts the registry, which is global and is the largest key', () => {
        expect(seasonKeys('s1', ['b1'])).not.toContain('db_players');
    });

    it('measures what dropping it would reclaim', () => {
        expect(seasonFootprint('s1', ['b1'])).toBeGreaterThan(0);
        expect(seasonFootprint('nosuchseason', [])).toBe(0);
    });
});

describe('who is still referenced', () => {
    beforeEach(() => {
        // A board entry's KEY is the player's id.
        put('db_boards/b1/entries', { p_onboard: { p: 'QB' } });
        // A slot carries the id of the man standing in it.
        put('db_seasons/s1/charts/rosterState/rows', {
            QB: { s: [{ n: 'Someone', i: 'p_onroster' }, null] },
        });
        put('db_seasons/s2/charts/rosterState/rows', {
            QB: { s: [{ n: 'Old Season Man', i: 'p_gone' }] },
        });
    });

    it('keeps everybody a surviving season still points at', () => {
        const { keep } = reachablePlayerIds(['s1'], { s1: ['b1'] });
        expect([...keep].sort()).toEqual(['p_onboard', 'p_onroster']);
    });

    it('does not keep a player only an evicted season referenced', () => {
        const { keep } = reachablePlayerIds(['s1'], { s1: ['b1'] });
        expect(keep.has('p_gone')).toBe(false);
    });

    it('counts a slot with no id as a refusal to answer, not as nobody', () => {
        // Pruning on this would delete a man who IS on the roster.
        put('db_seasons/s1/charts/rosterState/rows', {
            QB: { s: [{ n: 'No Id Here' }] },
        });
        const { keep, unresolvedSlots } = reachablePlayerIds(['s1'], { s1: [] });
        expect(keep.size).toBe(0);
        expect(unresolvedSlots).toBe(1);
    });
});

describe('the filler, so the threshold can be reached on purpose', () => {
    it('adds and removes real weight', () => {
        const before = storageUsage().bytes;
        expect(addFiller(0.5)).toBe(true);
        expect(storageUsage().bytes).toBeGreaterThan(before + 500_000);
        clearFiller();
        expect(localStorage.getItem(FILLER_KEY)).toBe(null);
    });
});

describe('dropping a season', () => {
    const fakeRepo = (pending = 0) => {
        const cleared = [];
        const committed = [];
        return {
            cleared, committed,
            syncState: () => ({ pending }),
            clear: async (c) => { cleared.push(c); localStorage.removeItem(`db_${c}`); },
            commit: async (c, changes) => { committed.push([c, changes]); },
        };
    };

    beforeEach(() => {
        put('db_seasons/s_old/charts/rosterState/rows', { QB: { s: [{ n: 'Old Man', i: 'p_old' }] } });
        put('db_seasons/s_new/charts/rosterState/rows', { QB: { s: [{ n: 'New Man', i: 'p_new' }] } });
        put('db_boards/b_old/entries', { p_old: {} });
        put('db_players', { p_old: {}, p_new: {} });
    });

    it('picks the oldest by year, and never the one being worked in', () => {
        const seasons = [{ id: 's_new', year: 2027 }, { id: 's_old', year: 2025 }];
        expect(oldestEvictable(seasons, 's_new').id).toBe('s_old');
        // If the oldest IS the current one, it is not a candidate.
        expect(oldestEvictable(seasons, 's_old').id).toBe('s_new');
    });

    it('refuses while writes are still queued, rather than losing them', async () => {
        const repo = fakeRepo(3);
        const out = await evictSeason({ repository: repo, seasonId: 's_old', boardIds: ['b_old'] });
        expect(out).toEqual({ ok: false, reason: 'unflushed', pending: 3 });
        expect(repo.cleared).toEqual([]);
    });

    it('refuses when a surviving slot cannot say who it holds', async () => {
        put('db_seasons/s_new/charts/rosterState/rows', { QB: { s: [{ n: 'No Id' }] } });
        const out = await evictSeason({
            repository: fakeRepo(), seasonId: 's_old', boardIds: ['b_old'],
            survivingSeasonIds: ['s_new'],
        });
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('unresolved-slots');
    });

    it('drops the season and prunes only players nobody is left pointing at', async () => {
        const repo = fakeRepo();
        const out = await evictSeason({
            repository: repo, seasonId: 's_old', boardIds: ['b_old'],
            survivingSeasonIds: ['s_new'], boardIdsBySeason: { s_new: [] },
        });
        expect(out.ok).toBe(true);
        expect(out.pruned).toBe(1);
        expect(repo.committed[0][0]).toBe('players');
        expect(repo.committed[0][1]).toEqual([{ id: 'p_old', doc: null }]);
        // The man still on the surviving roster is untouched.
        expect(repo.committed[0][1].map(c => c.id)).not.toContain('p_new');
    });
});
