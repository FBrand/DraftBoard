import { describe, it, expect, beforeEach } from 'vitest';
import { initialiseSeason, isInitialised, forgetSeason } from '../../src/utils/seasonInit';
import { seasonScopedKey } from '../../src/utils/appStorage';

/**
 * What a season starts with.
 *
 * Each stage used to answer this for itself — is there a saved state, is the
 * app in seeded mode, does a shipped file exist — and the answers only agreed
 * while there was one season. With two, rolling over left last year's roster
 * in place, re-read last year's picks out of DraftBoard_Picks.csv and fell
 * back to the shipped rankings for a class that had not been drafted yet.
 *
 * It is one decision now, made once and recorded. Recorded rather than
 * inferred, because "the draft is empty" and "the draft has not been set up"
 * look identical in storage, and reading the first as the second is what
 * re-seeded a season somebody had deliberately cleared.
 */
const key = (base, season) => seasonScopedKey(base, season);

beforeEach(() => { globalThis.resetStorage(); });

describe('setting a season up', () => {
    it('does it once and says so', () => {
        expect(isInitialised('s1')).toBe(false);
        expect(initialiseSeason('s1')).toBe(true);
        expect(isInitialised('s1')).toBe(true);
    });

    it('does not run again, so a season somebody cleared stays cleared', () => {
        initialiseSeason('s1');
        localStorage.setItem(key('nfl_draft_board_state', 's1'), '{"draftedPlayers":[{"name":"Somebody"}]}');

        expect(initialiseSeason('s1')).toBe(false);
        expect(localStorage.getItem(key('nfl_draft_board_state', 's1'))).toContain('Somebody');
    });

    it('starts the draft empty', () => {
        initialiseSeason('s1');
        expect(JSON.parse(localStorage.getItem(key('nfl_draft_board_state', 's1')))).toEqual({
            draftedPlayers: [], ourPicksLeft: [],
        });
    });

    it('starts the roster empty when there is nothing to carry', () => {
        initialiseSeason('s1');
        const roster = JSON.parse(localStorage.getItem(key('rosterState', 's1')));
        expect(roster.depthChart).toEqual({});
        expect(roster.cuts).toEqual([]);
    });

    it('leaves the prospect pool absent rather than written empty', () => {
        // It seeds itself on first use, and an empty written state is
        // indistinguishable from one somebody cleared.
        initialiseSeason('s1');
        expect(localStorage.getItem(key('prospects_v1', 's1'))).toBeNull();
    });

    it('refuses without a season', () => {
        expect(initialiseSeason(null)).toBe(false);
    });
});

describe('what a rollover hands the new season', () => {
    // An offseason STARTS at free agency and ENDS at a 53-man roster. So last
    // season's roster is not the new roster — it is the pool of players whose
    // futures are the question. The new roster keeps its shape and none of its
    // players, which is the same split the shipped files make: one file gives
    // the structure, another gives free agency its candidates.
    const LAST_YEAR = JSON.stringify({
        version: 1,
        positionConfig: { offense: [{ id: 'qb', label: 'QB', slots53: 2 }], defense: [] },
        depthChart: { qb: [{ name: 'Patrick Mahomes', zone: '53' }] },
        reserve: [{ name: 'Somebody Hurt', zone: 'ir' }],
        cuts: [{ name: 'Somebody Cut', zone: 'cut' }],
    });

    it('puts last season’s roster into free agency, where the offseason starts', () => {
        localStorage.setItem(key('rosterState', 's1'), LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        const fa = JSON.parse(localStorage.getItem(key('fa_state_v1', 's2')));
        expect(fa.depthChart.qb.map(s => s.name)).toEqual(['Patrick Mahomes']);
    });

    it('gives the new roster the shape and none of the players', () => {
        localStorage.setItem(key('rosterState', 's1'), LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        const roster = JSON.parse(localStorage.getItem(key('rosterState', 's2')));
        expect(roster.positionConfig.offense).toEqual([{ id: 'qb', label: 'QB', slots53: 2 }]);
        expect(roster.depthChart).toEqual({ qb: [] });
        expect(roster.reserve).toEqual([]);
        expect(roster.cuts).toEqual([]);
    });

    it('does not carry last season’s injuries or cuts into either', () => {
        localStorage.setItem(key('rosterState', 's1'), LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        expect(JSON.parse(localStorage.getItem(key('rosterState', 's2'))).reserve).toEqual([]);
    });

    it('copies rather than shares, so this year does not rewrite last year', () => {
        localStorage.setItem(key('rosterState', 's1'), LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        localStorage.setItem(key('rosterState', 's2'), '{"version":1,"depthChart":{},"reserve":[],"cuts":[]}');
        expect(localStorage.getItem(key('rosterState', 's1'))).toBe(LAST_YEAR);
    });

    it('starts empty when the season it came from has no roster', () => {
        initialiseSeason('s2', { carryRosterFrom: 's1' });
        expect(JSON.parse(localStorage.getItem(key('rosterState', 's2'))).depthChart).toEqual({});
        expect(localStorage.getItem(key('fa_state_v1', 's2'))).toBeNull();
    });
});

describe('forgetting a scrapped season', () => {
    it('drops its id, so the same id is never marked done forever', () => {
        initialiseSeason('s1');
        initialiseSeason('s2');

        forgetSeason('s2');

        expect(isInitialised('s2')).toBe(false);
        expect(isInitialised('s1')).toBe(true);
    });
});
