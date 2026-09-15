import { describe, it, expect, afterEach } from 'vitest';
import { setCurrentUser, isSignedIn, isExpert, canEdit, editRefusal } from '../../src/utils/permissions';

/**
 * A viewer is signed in, and owns nothing.
 *
 * Anonymous sign-in gives every viewer a uid so his play-along has an identity
 * of its own. It grants no write access — the rules refuse an anonymous
 * provider — but it does make `isSignedIn()` true, and that is the trap: the
 * ownership check used to read "signed in and not the owner" as "not yours".
 * Every board carries an ownerId, so wiring anonymous sign-in up turned every
 * expert's board read-only for the very people it exists for, and took their
 * own play-along with it.
 */
const viewer = { id: 'anon-uid', name: 'Signed in', provider: 'anonymous', isAnonymous: true };
const dan = { id: 'dan-uid', name: 'Dan', provider: 'google.com', isAnonymous: false };

afterEach(() => setCurrentUser(null));

describe('an anonymous viewer', () => {
    it('is signed in and is still not an expert', () => {
        setCurrentUser(viewer);
        expect(isSignedIn()).toBe(true);
        expect(isExpert()).toBe(false);
    });

    it('may still edit a board somebody else owns, because his copy is his own', () => {
        setCurrentUser(viewer);
        expect(canEdit({ ownerId: 'dan-uid', kind: 'placement' })).toBe(true);
    });

    it('may still write an evaluation', () => {
        setCurrentUser(viewer);
        expect(canEdit({ ownerId: 'dan-uid', kind: 'evaluation' })).toBe(true);
    });
});

describe('an expert', () => {
    it('is an expert', () => {
        setCurrentUser(dan);
        expect(isExpert()).toBe(true);
    });

    it('edits his own board', () => {
        setCurrentUser(dan);
        expect(canEdit({ ownerId: 'dan-uid', kind: 'placement' })).toBe(true);
    });

    it('is told whose board it is when it is not his', () => {
        setCurrentUser(dan);
        const refusal = editRefusal({ ownerId: 'ryan-uid', kind: 'placement' });
        expect(refusal?.reason).toBe('not-yours');
    });
});

describe('nobody signed in', () => {
    it('edits freely, which is the local-only app', () => {
        setCurrentUser(null);
        expect(isSignedIn()).toBe(false);
        expect(isExpert()).toBe(false);
        expect(canEdit({ ownerId: 'dan-uid', kind: 'placement' })).toBe(true);
    });
});
