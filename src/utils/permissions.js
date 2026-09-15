/**
 * May this change?
 *
 * One question with several reasons to answer no, and they have to be asked in
 * one place or they will disagree. There are two reasons today and a third is
 * coming:
 *
 *   - **The season is archived.** A board is the record of where somebody had
 *     a player at the time, the roster is how it finished, the draft is what
 *     happened. History is not edited. Evaluations are the exception, because
 *     what you know about a player keeps growing after the board that ranked
 *     him is done.
 *   - **It is not yours.** An expert writes his own boards. Everybody else
 *     reads them and keeps their own work locally. Nothing is written today —
 *     there is no sign-in yet — so this always answers yes, and the shape is
 *     here so that adding auth is a change to `session.js` rather than a hunt
 *     through every view.
 *   - **The store refused.** Not a permission, but it lands in the same place:
 *     the user wants to know why a thing will not move.
 *
 * The alternative was what this replaces: `isReadOnly()` answering half of it
 * from boardRegistry, every view asking separately, and a third reason
 * arriving with nowhere obvious to go. Two functions that can disagree about
 * whether an edit is allowed is a bug waiting for a Tuesday.
 */
import { viewedSeason } from './boardRegistry';

/** The signed-in expert, or null. Auth lands here; nothing else changes. */
let currentUser = null;

export function setCurrentUser(user) {
    currentUser = user ?? null;
}

export function getCurrentUser() {
    return currentUser;
}

/**
 * Whether anybody is signed in at all — an anonymous viewer included.
 * Almost no caller wants this one; see isExpert.
 */
export function isSignedIn() {
    return !!currentUser?.id;
}

/**
 * Whether the signed-in person is an expert — somebody whose writes the
 * database will actually accept.
 *
 * A viewer IS signed in, anonymously, so that his play-along has an identity
 * of its own. He is the author of nothing. Asking isSignedIn() here is the
 * trap auth.js warns about, and it is not hypothetical: every board carries an
 * ownerId, so the moment anonymous sign-in is wired up, "is this mine?" starts
 * answering no for every board a viewer opens, and the app stops letting him
 * touch his own play-along.
 */
export function isExpert() {
    return !!currentUser?.id && currentUser.provider !== 'anonymous' && !currentUser.isAnonymous;
}

/**
 * Why an edit is refused, or null when it is allowed.
 *
 * A reason rather than a boolean, because every caller that blocks an edit
 * also has to explain it, and "no" on its own has been the thing that made
 * the app look broken: the season banner exists precisely because stages were
 * silently refusing writes.
 *
 * @param {object} [subject]
 * @param {string} [subject.ownerId]  who owns the thing being changed
 * @param {string} [subject.kind]     'placement' | 'evaluation' | 'stage'
 * @returns {{reason: string, message: string}|null}
 */
export function editRefusal(subject = {}) {
    const season = viewedSeason();

    if (season && season.status !== 'current') {
        // An evaluation is not a placement. Writing down what you have learned
        // about a player is not editing the record of where he was ranked.
        if (subject.kind === 'evaluation') return null;
        return {
            reason: 'archived-season',
            message: `${season.year} is finished — its boards, roster and draft are the record of that season.`,
        };
    }

    if (subject.ownerId && isExpert() && subject.ownerId !== currentUser.id) {
        return {
            reason: 'not-yours',
            message: 'This board belongs to somebody else. Copy it to make your own.',
        };
    }

    return null;
}

/** The same question as a boolean, for callers that only branch on it. */
export function canEdit(subject = {}) {
    return editRefusal(subject) === null;
}
