import { describe, it, expect, beforeEach } from 'vitest';
import { openDraft, readDraft, writeDraft, removeDraft, hasDraft } from '../../src/data/draftStore';
import { repository } from '../../src/data/repository';
import { loadRegistry, resolveAll, byId, factsFor } from '../../src/utils/playerRegistry';
import { setSessionTeam } from '../../src/utils/appSettings';

/**
 * The draft, recorded on the players it happened to.
 *
 * There is no picks collection. A selection is `draftPick` + `team` +
 * `draftYear` on the player's registry record, because that is what a pick IS,
 * and a second document saying the same thing was 210KB of a 745KB budget and
 * two answers that could disagree — the registry knew a draft outcome for 295
 * players while the picks collection held 631.
 */
const SEASON = 's2026';

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    setSessionTeam('KC');
    await repository.set('seasons', SEASON, { id: SEASON, year: 2026, status: 'current' });
    await Promise.all([loadRegistry(), openDraft()]);
});

const register = (name, position, school) => resolveAll([{ name, position, school }])[0];
const pick = (id, pickNumber, team) => ({ playerId: id, pickNumber, team });

describe('a selection', () => {
    it('is written onto the player, not into a collection of its own', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 1, 'LV')] });

        const record = byId(id);
        expect(record.draftPick).toBe(1);
        expect(record.team).toBe('LV');
        expect(record.draftYear).toBe(2026);
        expect(record.isUdfa).toBe(false);
        // Nothing else stores it.
        expect(repository.all('draft_picks')).toEqual([]);
    });

    it('reads back as the pick the board has always been handed', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 1, 'LV')] });

        const [back] = readDraft(SEASON).draftedPlayers;
        expect(back).toMatchObject({
            playerId: id, name: 'Fernando Mendoza', position: 'QB',
            pickNumber: 1, team: 'LV', drafted: true,
        });
    });

    it('follows a rename, because there is no second copy of the name', () => {
        const id = register('Fernand Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 1, 'LV')] });
        repository.set('players', id, { ...byId(id), name: 'Fernando Mendoza' });

        expect(readDraft(SEASON).draftedPlayers[0].name).toBe('Fernando Mendoza');
    });
});

describe('an undrafted signing', () => {
    it('gets no pick number — "UDFA" is a label, not a slot', () => {
        const id = register('Omari Evans', 'WR', 'Penn State');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 'UDFA', 'KC')] });

        // lean() drops nulls on the way to storage, so an absent field IS
        // null — factsFor is the accessor that normalises it back.
        expect(factsFor(id).draftPick).toBeNull();
        expect(factsFor(id).isUdfa).toBe(true);
        expect(readDraft(SEASON).draftedPlayers[0].pickNumber).toBe('UDFA');
    });

    it('signed with no club is nobody’s, least of all ours', () => {
        const id = register('Omari Evans', 'WR', 'Penn State');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 'UDFA', null)] });
        expect(readDraft(SEASON).draftedPlayers[0].draftedByUs).toBe(false);
    });

    it('sorts after every numbered pick, since there is no order among them', () => {
        const a = register('Omari Evans', 'WR', 'Penn State');
        const b = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, { draftedPlayers: [pick(a, 'UDFA', 'KC'), pick(b, 9, 'KC')] });

        expect(readDraft(SEASON).draftedPlayers.map(p => p.pickNumber)).toEqual([9, 'UDFA']);
    });
});

describe('draftedByUs, a comparison rather than a fact', () => {
    it('moves when the session team does, which a stored answer could not', () => {
        const id = register('Arvell Reese', 'EDGE', 'Ohio State');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 2, 'DEN')] });
        expect(readDraft(SEASON).draftedPlayers[0].draftedByUs).toBe(false);

        setSessionTeam('DEN');
        expect(readDraft(SEASON).draftedPlayers[0].draftedByUs).toBe(true);
    });
});

describe('taking it back', () => {
    it('undoing a pick clears the facts it set', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, { draftedPlayers: [pick(id, 1, 'LV')] });
        writeDraft(SEASON, { draftedPlayers: [] });

        expect(factsFor(id).draftPick).toBeNull();
        expect(factsFor(id).draftYear).toBeNull();
        expect(readDraft(SEASON)?.draftedPlayers ?? []).toEqual([]);
    });

    it('scrapping a season clears its class and leaves every other year alone', () => {
        const rookie = register('Fernando Mendoza', 'QB', 'Indiana');
        const veteran = register('Patrick Mahomes', 'QB', 'Texas Tech');
        writeDraft(SEASON, { draftedPlayers: [pick(rookie, 1, 'LV')] });
        // A veteran carries his own draft year and is not part of this class.
        repository.set('players', veteran, { ...byId(veteran), draftYear: 2017, draftPick: 10, team: 'KC' });

        removeDraft(SEASON);

        expect(factsFor(rookie).draftPick).toBeNull();
        expect(byId(veteran).draftPick).toBe(10);
        expect(byId(veteran).draftYear).toBe(2017);
    });
});

describe('what the season still owns', () => {
    it('keeps whose turn it is, which is the draft’s own and nobody’s fact', () => {
        writeDraft(SEASON, { draftedPlayers: [], currentPick: 42, ourPicksLeft: [42, 73] });
        const back = readDraft(SEASON);
        expect(back.currentPick).toBe(42);
        expect(back.ourPicksLeft).toEqual([42, 73]);
    });

    it('knows a season has a draft once anybody has been taken in it', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        expect(hasDraft(SEASON)).toBe(false);
        writeDraft(SEASON, { draftedPlayers: [pick(id, 1, 'LV')] });
        expect(hasDraft(SEASON)).toBe(true);
    });
});
