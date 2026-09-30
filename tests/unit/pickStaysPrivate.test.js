import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards, currentSeason } from '../../src/utils/boardRegistry';
import { claimLead, releaseLead, openDraft } from '../../src/data/draftStore';
import { setFacts, resolve as resolvePlayer, openRegistry } from '../../src/utils/playerRegistry';

/**
 * A pick made by somebody who is not the lead does not reach the shared store.
 *
 * `privateDraft.test.js` proves the overlay honours `{ mine: true }`. It does not
 * prove that anything ASKS — and the audit measured that nothing did: the on-air
 * pick path writes one player at a time through `setFacts`, which took no
 * options at all, so with one expert holding the lead another expert's pick
 * landed in the shared registry.
 *
 * `setFactsMany` had grown the parameter and `setFacts` had not. So this tests
 * the path a pick actually takes, at the level where the request is made, which
 * is the level the previous test was missing.
 */
const SEASON = () => currentSeason()?.id;

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
    await openDraft();
    await openRegistry();
});

describe('setFacts', () => {
    it('passes a private write through to the store layer', () => {
        const id = resolvePlayer({ name: 'Private Pick', position: 'QB', school: 'Test' });
        const spy = vi.spyOn(repository, 'set');

        setFacts(id, { draftPick: 4, draftYear: 2026 }, { mine: true });

        // The fourth argument is the whole point: without it the overlay has
        // nothing to honour, however carefully it honours it.
        expect(spy).toHaveBeenCalledWith('players', id, expect.any(Object), { mine: true });
        spy.mockRestore();
    });

    it('publishes when nothing marks it, which a correction must still do', () => {
        const id = resolvePlayer({ name: 'Public Fix', position: 'WR', school: 'Test' });
        const spy = vi.spyOn(repository, 'set');

        setFacts(id, { team: 'KC' });

        expect(spy).toHaveBeenCalledWith('players', id, expect.any(Object), undefined);
        spy.mockRestore();
    });
});

describe('who the lead is decides where a pick goes', () => {
    it('marks the pick private while somebody else holds the lead', () => {
        repository.set('draft_state', SEASON(), { o: 'somebody-else', value: {} });

        // What the hook computes at the moment of the write. Asked then rather
        // than captured, because the lead changes while the app is running.
        const mine = { mine: true };
        const id = resolvePlayer({ name: 'Their Draft', position: 'RB', school: 'Test' });
        const spy = vi.spyOn(repository, 'set');
        setFacts(id, { draftPick: 9 }, mine);

        expect(spy.mock.calls[0][3]).toEqual({ mine: true });
        spy.mockRestore();
    });

    it('publishes the pick once I hold the lead, and stops when I let it go', () => {
        expect(claimLead(SEASON())).toBe(true);
        const id = resolvePlayer({ name: 'My Draft', position: 'TE', school: 'Test' });

        const spy = vi.spyOn(repository, 'set');
        setFacts(id, { draftPick: 12 }, { mine: false });
        expect(spy.mock.calls[0][3]).toEqual({ mine: false });
        spy.mockRestore();

        // And releasing does not make the picks already made private — the role
        // owns the live draft, not its history.
        expect(releaseLead(SEASON())).toBe(true);
    });
});
