import { describe, it, expect, beforeEach } from 'vitest';
import { initialiseSeason, isInitialised, forgetSeason, setupPath } from '../../src/utils/seasonInit';
import { readStage, writeStage } from '../../src/data/stageStore';
import { readChart, writeChart, openDepthCharts } from '../../src/data/depthChartStore';
import { readDraft } from '../../src/data/draftStore';
import { repository } from '../../src/data/repository';

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
beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openDepthCharts();
});

describe('setting a season up', () => {
    it('does it once and says so', () => {
        expect(isInitialised('s1')).toBe(false);
        expect(initialiseSeason('s1')).toBe(true);
        expect(isInitialised('s1')).toBe(true);
    });

    it('does not run again, so a season somebody cleared stays cleared', () => {
        initialiseSeason('s1');
        writeStage('nfl_draft_board_state', 's1', { draftedPlayers: [{ name: 'Somebody' }] });

        expect(initialiseSeason('s1')).toBe(false);
        expect(JSON.stringify(readStage('nfl_draft_board_state', 's1'))).toContain('Somebody');
    });

    it('starts the draft empty', () => {
        // Picks are documents now — see data/draftStore.js — so "empty" means
        // no picks, not a blob containing an empty list.
        initialiseSeason('s1');
        expect(readDraft('s1')).toEqual({ ourPicksLeft: [], draftedPlayers: [] });
    });

    it('starts the roster empty when there is nothing to carry', () => {
        initialiseSeason('s1');
        const roster = readChart('rosterState', 's1');
        expect(roster.depthChart).toEqual({});
        expect(roster.cuts).toEqual([]);
    });

    it('leaves the prospect pool absent rather than written empty', () => {
        // It seeds itself on first use, and an empty written state is
        // indistinguishable from one somebody cleared.
        initialiseSeason('s1');
        expect(readStage('prospects_v1', 's1')).toBeNull();
    });

    it('refuses without a season', () => {
        expect(initialiseSeason(null)).toBe(false);
    });
});

describe('what a rollover hands the new season', () => {
    // These read and write the DEPTH CHART store, because that is where the
    // roster and free agency actually live. They used to use the stage store
    // on both sides, which made them agree with themselves and with nothing
    // the app does — the rollover shipped reading an empty stage blob, and
    // every one of these passed while it did.
    // An offseason STARTS at free agency and ENDS at a 53-man roster. So last
    // season's roster is not the new roster — it is the pool of players whose
    // futures are the question. The new roster keeps its shape and none of its
    // players, which is the same split the shipped files make: one file gives
    // the structure, another gives free agency its candidates.
    const LAST_YEAR = {
        version: 1,
        positionConfig: { offense: [{ id: 'qb', label: 'QB', slots53: 2 }], defense: [] },
        depthChart: { qb: [{ name: 'Patrick Mahomes', zone: '53' }] },
        reserve: [{ name: 'Somebody Hurt', zone: 'ir' }],
        cuts: [{ name: 'Somebody Cut', zone: 'cut' }],
    };

    it('puts last season’s roster into free agency, where the offseason starts', () => {
        writeChart('rosterState', 's1', LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        const fa = readChart('fa_state_v1', 's2');
        expect(fa.depthChart.qb.map(s => s.name)).toEqual(['Patrick Mahomes']);
    });

    it('gives the new roster the shape and none of the players', () => {
        writeChart('rosterState', 's1', LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        const roster = readChart('rosterState', 's2');
        expect(roster.positionConfig.offense).toEqual([{ id: 'qb', label: 'QB', slots53: 2 }]);
        expect(roster.depthChart).toEqual({ qb: [] });
        expect(roster.reserve).toEqual([]);
        expect(roster.cuts).toEqual([]);
    });

    it('does not carry last season’s injuries or cuts into either', () => {
        writeChart('rosterState', 's1', LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        expect(readChart('rosterState', 's2').reserve).toEqual([]);
    });

    it('copies rather than shares, so this year does not rewrite last year', () => {
        writeChart('rosterState', 's1', LAST_YEAR);
        initialiseSeason('s2', { carryRosterFrom: 's1' });

        writeChart('rosterState', 's2', { version: 1, depthChart: {}, reserve: [], cuts: [] });
        const s1 = readChart('rosterState', 's1');
        expect(s1.depthChart.qb.map(x => x.name)).toEqual(['Patrick Mahomes']);
        expect(s1.reserve.map(x => x.name)).toEqual(['Somebody Hurt']);
    });

    it('starts empty when the season it came from has no roster', () => {
        initialiseSeason('s2', { carryRosterFrom: 's1' });
        expect(readChart('rosterState', 's2').depthChart).toEqual({});
        expect(readChart('fa_state_v1', 's2').depthChart).toEqual({});
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

/**
 * The marker lives where the data does.
 *
 * It was a localStorage key, which is the right answer for exactly one
 * backend. Point the app at a shared store and every visitor arrives with an
 * empty local marker, decides the season was never set up, and seeds it again
 * over the top of everybody's work.
 */
describe('where "already set up" is recorded', () => {
    it('is a document beside the data, not a key in this browser', () => {
        initialiseSeason('s1');

        expect(repository.get(setupPath('s1'), 'season')).toBeTruthy();
        expect(localStorage.getItem('season_init_v1')).toBeNull();
    });

    it('is seen by a client that has never run the import', () => {
        // The same store, a different browser: it must not seed again.
        initialiseSeason('s1');
        const marker = repository.get(setupPath('s1'), 'season');

        repository.invalidate();
        repository.set(setupPath('s1'), 'season', marker);

        expect(isInitialised('s1')).toBe(true);
        expect(initialiseSeason('s1')).toBe(false);
    });

    it('records when it ran, which is the only question worth asking of it later', () => {
        initialiseSeason('s1');
        // Epoch milliseconds, not an ISO string: 24 characters to carry 13 was the
        // same trade every other timestamp in the store stopped making.
        expect(typeof repository.get(setupPath('s1'), 'season').at).toBe('number');
    });
});
