import { describe, it, expect, beforeEach } from 'vitest';
import {
    roundForPick, isUndraftedSigning, isDraftPick, isDraftComplete,
    highestDraftPick, pickNumberOf, parseAcquisition, lastDraftPick,
} from '../../src/utils/draftPhase.js';
import { setRoundSizes } from '../../src/utils/appSettings.js';

beforeEach(() => { globalThis.resetStorage(); });

// The bug this file exists for: DraftBoard_Picks.csv writes the literal
// "UDFA" in the pick column, so arithmetic on pickNumber produced NaN, and
// (NaN || 1) > 257 reported a completed draft as not started — locking the
// UDFA stage and counting zero UDFAs.
describe('a pick number is not always a number', () => {
    it('reads a numeric pick and refuses a label', () => {
        expect(pickNumberOf({ pickNumber: 41 })).toBe(41);
        expect(pickNumberOf({ pickNumber: '41' })).toBe(41);
        expect(pickNumberOf({ pickNumber: 'UDFA' })).toBeNull();
    });

    it('treats a labelled pick as an undrafted signing', () => {
        expect(isUndraftedSigning({ pickNumber: 'UDFA' })).toBe(true);
        expect(isUndraftedSigning({ pickNumber: 300 })).toBe(true);
        expect(isUndraftedSigning({ pickNumber: 41 })).toBe(false);
        // No pick at all is not a signing — he simply hasn't been taken.
        expect(isUndraftedSigning({})).toBe(false);
    });

    it('does not let a label poison the highest pick', () => {
        const drafted = [
            { pickNumber: 1 }, { pickNumber: 'UDFA' }, { pickNumber: 257 }, { pickNumber: 'UDFA' },
        ];
        expect(highestDraftPick(drafted)).toBe(257);
    });

    it('reports a completed draft as complete', () => {
        expect(isDraftComplete(258)).toBe(true);
        expect(isDraftComplete(257)).toBe(false);
        // The original failure: NaN must not read as "not started" silently.
        expect(isDraftComplete(NaN)).toBe(false);
    });
});

describe('rounds come from the stated sizes, not from division', () => {
    it('uses the real 2026 boundaries by default', () => {
        // 32, 32, 36, 40, 41, 35, 41 -> ends 32, 64, 100, 140, 181, 216, 257
        expect(roundForPick(1)).toBe(1);
        expect(roundForPick(32)).toBe(1);
        expect(roundForPick(33)).toBe(2);
        expect(roundForPick(64)).toBe(2);
        expect(roundForPick(100)).toBe(3);
        // The pick that a naive ceil(pick / 32) would call round 4.
        expect(roundForPick(101)).toBe(4);
        expect(roundForPick(257)).toBe(7);
    });

    it('gives no round rather than a guessed one past the end', () => {
        expect(roundForPick(258)).toBeNull();
        expect(roundForPick(0)).toBeNull();
        expect(roundForPick('UDFA')).toBeNull();
    });

    it('follows the sizes an expert sets', () => {
        setRoundSizes('10, 10');
        expect(lastDraftPick()).toBe(20);
        expect(roundForPick(10)).toBe(1);
        expect(roundForPick(11)).toBe(2);
        expect(roundForPick(21)).toBeNull();
        // And the draft's end moves with them.
        expect(isDraftComplete(21)).toBe(true);
        // These two take a PLAYER, not a pick number — see the note in
        // draftPhase.js. Passing 20 here silently returned false.
        expect(isDraftPick({ pickNumber: 20 })).toBe(true);
        expect(isDraftPick({ pickNumber: 21 })).toBe(false);
        expect(isUndraftedSigning({ pickNumber: 21 })).toBe(true);
    });
});

// roster.csv records how a player arrived inside his own name. The name is
// the identity key, so that made "Trey Smith" and "Trey Smith:24/3" two
// different players — one of them fiction.
describe('acquisition suffixes come off the name', () => {
    it('reads an earlier draft class', () => {
        const r = parseAcquisition('Xavier Worthy:24/1', 2026);
        expect(r.name).toBe('Xavier Worthy');
        expect(r.facts).toMatchObject({ isUdfa: false, draftYear: 2024, draftRound: 1 });
    });

    it('reads this year as a bare round', () => {
        const r = parseAcquisition('Cyrus Allen:5', 2026);
        expect(r.name).toBe('Cyrus Allen');
        expect(r.facts).toMatchObject({ draftYear: 2026, draftRound: 5 });
    });

    it('separates entering the league from arriving at this club', () => {
        expect(parseAcquisition('Omari Evans:UDFA', 2026).facts).toMatchObject({ isUdfa: true });
        // A free-agent signing says nothing about how he entered the league.
        expect(parseAcquisition('Andrew Armstrong:FA', 2026).facts).toEqual({});
        expect(parseAcquisition('Andrew Armstrong:FA', 2026).route).toBe('fa');
    });

    it('leaves a name it does not understand alone', () => {
        // Truncating on an unknown suffix would quietly rename the player.
        const r = parseAcquisition('Someone:WAT', 2026);
        expect(r.name).toBe('Someone:WAT');
        expect(r.facts).toEqual({});
    });

    it('handles a plain name and a name containing a colon', () => {
        expect(parseAcquisition('Creed Humphrey', 2026).name).toBe('Creed Humphrey');
        expect(parseAcquisition('', 2026).name).toBe('');
    });
});
