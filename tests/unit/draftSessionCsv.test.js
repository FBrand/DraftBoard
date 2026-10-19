import { describe, it, expect } from 'vitest';
import { serializeDraftState, deserializeDraftState, getExportFilename } from '../../src/utils/sessionSerializer';

/**
 * The draft session, out to a CSV and back.
 *
 * This is the file an analyst saves mid-draft and the one `DraftBoard_Picks.csv`
 * is read as at bootstrap, so it decides what a restored draft looks like. It
 * had no test.
 *
 * The thing it keeps getting wrong is that A PICK NUMBER IS NOT ALWAYS A
 * NUMBER: an undrafted signing is recorded as the literal `UDFA`. That is what
 * made `Math.max(257, "UDFA")` return NaN and report a finished draft as never
 * started, and it is what made the sort here do nothing at all.
 */
const player = (pickNumber, name, position = 'WR', team = 'KC') => ({ pickNumber, name, position, team });

describe('a session round trip', () => {
    it('brings back every player, with his pick, position and team', () => {
        const csv = serializeDraftState([player(1, 'Arvell Reese', 'EDGE', 'NYG')], [5, 9]);
        const { draftedPlayers, ourPicksLeft } = deserializeDraftState(csv);

        expect(draftedPlayers).toHaveLength(1);
        expect(draftedPlayers[0]).toMatchObject({
            pickNumber: 1, name: 'Arvell Reese', position: 'EDGE', team: 'NYG', drafted: true,
        });
        expect(ourPicksLeft).toEqual([5, 9]);
    });

    it('sorts the picks, even when undrafted signings are in the file', () => {
        // The regression: `a.pickNumber - b.pickNumber` is NaN against "UDFA",
        // and a comparator returning NaN does not throw — it sorts nothing. A
        // session with one UDFA in it came back in file order: 3, 1, 2.
        const csv = serializeDraftState([
            player(3, 'Third Pick'), player('UDFA', 'Aaron Undrafted'),
            player(1, 'First Pick'), player('UDFA', 'Zed Undrafted'),
            player(2, 'Second Pick'),
        ], []);

        const names = deserializeDraftState(csv).draftedPlayers.map(p => p.name);
        expect(names).toEqual([
            'First Pick', 'Second Pick', 'Third Pick',
            'Aaron Undrafted', 'Zed Undrafted',   // after the picks, in their own order
        ]);
    });

    it('keeps UDFA as a label rather than turning it into a number', () => {
        const csv = serializeDraftState([player('UDFA', 'Omari Evans')], []);
        expect(deserializeDraftState(csv).draftedPlayers[0].pickNumber).toBe('UDFA');
    });

    it('carries a name containing a comma', () => {
        // Ourlads writes "Last, First", and this file has its own CSV handling
        // rather than csvUtils — so it needs its own proof.
        const csv = serializeDraftState([player(7, 'Smith, Trey')], []);
        expect(deserializeDraftState(csv).draftedPlayers[0].name).toBe('Smith, Trey');
    });

    it('carries a name containing a quote', () => {
        const csv = serializeDraftState([player(7, 'He said "no"')], []);
        expect(deserializeDraftState(csv).draftedPlayers[0].name).toBe('He said "no"');
    });

    it('drops a phantom pick 0 from an exhausted draft', () => {
        const { ourPicksLeft } = deserializeDraftState(
            '# OurPicksLeft: 0\noverall,player,position,team\n',
        );
        expect(ourPicksLeft).toEqual([]);
    });

    it('reads a file with no picks left and no players', () => {
        const { draftedPlayers, ourPicksLeft } = deserializeDraftState(serializeDraftState([], []));
        expect(draftedPlayers).toEqual([]);
        expect(ourPicksLeft).toEqual([]);
    });

    it('does not throw on a short or ragged row', () => {
        const csv = '# DraftBoard Session Export\noverall,player,position,team\n12\n13,"Somebody"\n';
        expect(() => deserializeDraftState(csv)).not.toThrow();
        const { draftedPlayers } = deserializeDraftState(csv);
        expect(draftedPlayers).toHaveLength(2);
        expect(draftedPlayers[0].name).toBe('Unknown Player');
        expect(draftedPlayers[1].name).toBe('Somebody');
    });
});

describe('the export filename', () => {
    it('is dated and ends in .csv', () => {
        expect(getExportFilename()).toMatch(/^DraftBoard_Session_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$/);
    });
});
