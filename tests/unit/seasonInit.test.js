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

    it('leaves free agency and the pool absent rather than written empty', () => {
        // Both seed themselves on first use, and an empty written state is
        // indistinguishable from one somebody cleared.
        initialiseSeason('s1');
        expect(localStorage.getItem(key('fa_state_v1', 's1'))).toBeNull();
        expect(localStorage.getItem(key('prospects_v1', 's1'))).toBeNull();
    });

    it('refuses without a season', () => {
        expect(initialiseSeason(null)).toBe(false);
    });
});

describe('carrying the roster forward', () => {
    // The one stage that continues: a draft class is entirely new players and
    // free agency is a new market, but the team does not stop existing in
    // February.
    const LAST_YEAR = '{"version":1,"depthChart":{"qb":[{"name":"Patrick Mahomes"}]},"reserve":[],"cuts":[]}';

    it('copies last season’s roster into the new one', () => {
        localStorage.setItem(key('rosterState', 's1'), LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        expect(localStorage.getItem(key('rosterState', 's2'))).toBe(LAST_YEAR);
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
