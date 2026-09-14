import { describe, it, expect, beforeEach } from 'vitest';
import { openDraft, readDraft, writeDraft, DRAFT_PICKS, draftScope } from '../../src/data/draftStore';
import { repository } from '../../src/data/repository';
import { loadRegistry, resolveAll, rename, byId } from '../../src/utils/playerRegistry';
import { setSessionTeam } from '../../src/utils/appSettings';

/**
 * What a pick document carries, and what it deliberately does not.
 *
 * A pick used to store the whole board player — 268 bytes to say four things,
 * none of it read back. What is left is meant to be only what the DRAFT did:
 * who, which slot, which club. Two of the fields that looked like they
 * belonged are re-derived on read instead, and this is the file that says why
 * they are allowed to be.
 */
const SEASON = 's2026';

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    setSessionTeam('KC');
    await Promise.all([loadRegistry(), openDraft()]);
});

const register = (name, position, school) => resolveAll([{ name, position, school }])[0];

const raw = (scope = draftScope(SEASON)) =>
    repository.all(DRAFT_PICKS).filter(d => d.scope === scope);

describe('a pick document', () => {
    it('does not store the name — that is the registry’s, and a copy of it goes stale', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, {
            draftedPlayers: [{ playerId: id, name: 'Fernando Mendoza', position: 'QB', pickNumber: 1, team: 'KC' }],
        });

        expect(raw()).toHaveLength(1);
        expect(raw()[0].name).toBeUndefined();
        expect(readDraft(SEASON).draftedPlayers[0].name).toBe('Fernando Mendoza');
    });

    it('follows a rename, which a stored name could not', () => {
        const id = register('Fernand Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, {
            draftedPlayers: [{ playerId: id, name: 'Fernand Mendoza', position: 'QB', pickNumber: 1, team: 'KC' }],
        });

        // The misspelling is corrected on the player, and nothing tells the
        // draft. That is the whole point of not keeping a second copy.
        rename(id, { name: 'Fernando Mendoza' });
        expect(byId(id).name).toBe('Fernando Mendoza');
        expect(readDraft(SEASON).draftedPlayers[0].name).toBe('Fernando Mendoza');
    });

    it('keeps the name when there is no player to look up — then it is the only identity there is', () => {
        writeDraft(SEASON, {
            draftedPlayers: [{ name: 'Some Rookie', position: 'DT', pickNumber: 9, team: 'DEN' }],
        });

        expect(raw()[0].name).toBe('Some Rookie');
        expect(readDraft(SEASON).draftedPlayers[0].name).toBe('Some Rookie');
    });
});

describe('draftedByUs, which is a comparison rather than a fact', () => {
    it('is derived from the pick’s club, not stored', () => {
        const ours = register('Fernando Mendoza', 'QB', 'Indiana');
        const theirs = register('Arvell Reese', 'EDGE', 'Ohio State');
        writeDraft(SEASON, {
            draftedPlayers: [
                { playerId: ours, name: 'Fernando Mendoza', position: 'QB', pickNumber: 1, team: 'KC' },
                { playerId: theirs, name: 'Arvell Reese', position: 'EDGE', pickNumber: 2, team: 'DEN' },
            ],
        });

        expect(raw().every(d => d.draftedByUs === undefined)).toBe(true);
        const back = readDraft(SEASON).draftedPlayers;
        expect(back.find(p => p.pickNumber === 1).draftedByUs).toBe(true);
        expect(back.find(p => p.pickNumber === 2).draftedByUs).toBe(false);
    });

    it('moves when the session team does, which a stored answer could not', () => {
        const id = register('Arvell Reese', 'EDGE', 'Ohio State');
        writeDraft(SEASON, {
            draftedPlayers: [{ playerId: id, name: 'Arvell Reese', position: 'EDGE', pickNumber: 2, team: 'DEN' }],
        });
        expect(readDraft(SEASON).draftedPlayers[0].draftedByUs).toBe(false);

        setSessionTeam('DEN');
        expect(readDraft(SEASON).draftedPlayers[0].draftedByUs).toBe(true);
    });

    it('is false for a signing with no club — "signed, nobody yet" is not ours', () => {
        const id = register('Omari Evans', 'WR', 'Penn State');
        writeDraft(SEASON, {
            draftedPlayers: [{ playerId: id, name: 'Omari Evans', position: 'WR', pickNumber: 300, team: null }],
        });

        expect(readDraft(SEASON).draftedPlayers[0].draftedByUs).toBe(false);
    });
});

describe('the document id', () => {
    it('is the player, so correcting the pick number rewrites the pick instead of adding one', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        const pick = n => ({ playerId: id, name: 'Fernando Mendoza', position: 'QB', pickNumber: n, team: 'KC' });

        writeDraft(SEASON, { draftedPlayers: [pick(14)] });
        writeDraft(SEASON, { draftedPlayers: [pick(41)] });

        // Keyed on the number, the correction left pick 14 behind and the
        // draft had one player twice.
        expect(raw()).toHaveLength(1);
        expect(readDraft(SEASON).draftedPlayers[0].pickNumber).toBe(41);
    });

    it('keeps a season’s picks out of another season’s', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, { draftedPlayers: [{ playerId: id, position: 'QB', pickNumber: 1, team: 'KC' }] });
        writeDraft('s2027', { draftedPlayers: [{ playerId: id, position: 'QB', pickNumber: 5, team: 'KC' }] });

        expect(readDraft(SEASON).draftedPlayers[0].pickNumber).toBe(1);
        expect(readDraft('s2027').draftedPlayers[0].pickNumber).toBe(5);
    });
});

describe('what stays', () => {
    it('keeps the position, because a pick can be somebody no rankings file knows', () => {
        writeDraft(SEASON, {
            draftedPlayers: [{ name: 'Nobody From Anywhere', position: 'LS', pickNumber: 257, team: 'LV' }],
        });
        expect(readDraft(SEASON).draftedPlayers[0].position).toBe('LS');
    });

    it('does not store a round — it cannot be inferred from the pick, so it is the player’s', () => {
        const id = register('Fernando Mendoza', 'QB', 'Indiana');
        writeDraft(SEASON, {
            draftedPlayers: [{ playerId: id, position: 'QB', pickNumber: 97, team: 'KC', draftRound: 3 }],
        });
        expect(raw()[0].draftRound).toBeUndefined();
    });
});
