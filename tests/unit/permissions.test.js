import { describe, it, expect, beforeEach } from 'vitest';
import { canEdit, editRefusal, setCurrentUser, isSignedIn } from '../../src/utils/permissions';
import { openBoards, currentSeason, startSeason, setViewedSeason, allBoards } from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';

/**
 * One question, several reasons to answer no.
 *
 * They were spread out: isReadOnly() answered the season half from
 * boardRegistry, each view asked separately, and auth was going to arrive with
 * nowhere obvious to go. Two functions that can disagree about whether an edit
 * is allowed is a bug waiting for a Tuesday.
 *
 * It returns a REASON rather than a boolean, because every caller that refuses
 * an edit also has to explain it — "no" on its own is what made the app look
 * broken when stages silently stopped saving.
 */
beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    setCurrentUser(null);
    await openBoards();
});

describe('the current season', () => {
    it('allows everything', () => {
        expect(canEdit({ kind: 'placement' })).toBe(true);
        expect(canEdit({ kind: 'stage' })).toBe(true);
        expect(editRefusal()).toBeNull();
    });
});

describe('an archived season', () => {
    beforeEach(async () => {
        const first = currentSeason();
        await startSeason(first.year + 1);
        setViewedSeason(first.id);
    });

    it('refuses a placement, and says which year and why', () => {
        const no = editRefusal({ kind: 'placement' });
        expect(no.reason).toBe('archived-season');
        expect(no.message).toContain('2026');
    });

    it('refuses a stage — the roster and the draft are the record too', () => {
        expect(canEdit({ kind: 'stage' })).toBe(false);
    });

    it('still allows an evaluation', () => {
        // What you know about a player keeps growing after the board that
        // ranked him is done. That is the whole reason old boards are kept
        // rather than deleted.
        expect(canEdit({ kind: 'evaluation' })).toBe(true);
    });
});

describe('whose board it is', () => {
    it('is nobody’s business while nobody is signed in', () => {
        // The normal case today: a viewer, no auth, everything local.
        expect(isSignedIn()).toBe(false);
        expect(canEdit({ ownerId: 'someone-else' })).toBe(true);
    });

    it('allows a signed-in expert his own board', () => {
        setCurrentUser({ id: 'u_ryan', isAllowed: true });
        expect(canEdit({ ownerId: 'u_ryan' })).toBe(true);
    });

    it('refuses somebody else’s, and points at the way forward', () => {
        setCurrentUser({ id: 'u_ryan', isAllowed: true });
        const no = editRefusal({ ownerId: 'u_dan' });
        expect(no.reason).toBe('not-yours');
        expect(no.message).toContain('Copy it');
    });

    it('asks the season first — an old board of your own is still history', async () => {
        setCurrentUser({ id: 'u_ryan', isAllowed: true });
        const first = currentSeason();
        await startSeason(first.year + 1);
        setViewedSeason(first.id);

        expect(editRefusal({ kind: 'placement', ownerId: 'u_ryan' }).reason).toBe('archived-season');
    });
});

describe('what the stores actually ask', () => {
    it('gives a board with no owner to whoever is looking', () => {
        // Consensus has no author and no owner — it is derived, not written.
        const consensus = allBoards().find(b => !b.authorId);
        expect(canEdit({ kind: 'placement', ownerId: consensus.ownerId })).toBe(true);
    });
});
