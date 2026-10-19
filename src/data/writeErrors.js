/**
 * Whether trying again could possibly help.
 *
 * The queue treated every refusal the same: five attempts, widening gaps, then
 * give up. That is right for a connection that is down and wrong for a write
 * the store has judged and rejected — retrying a permission error four more
 * times achieves nothing except burying the reason under "retrying", which is
 * the one word that tells somebody to sit and wait.
 *
 * Two kinds:
 *
 *   **transient** — the store could not be reached, or was busy. Offline, a
 *   timeout, a 503. Trying again is the entire remedy.
 *
 *   **permanent** — the store understood the write and said no. A rule
 *   rejected it, the document is too big, a field holds something that cannot
 *   be stored. The same write will be refused for ever, so it stops now and
 *   says which.
 *
 * A quota failure is permanent by this test, which reads oddly and is right:
 * nothing the app can do makes room, so retrying in eight seconds is a lie.
 * What resolves it is a person exporting and clearing, which is exactly what
 * the failed state offers.
 */

/** Firestore's own codes, for when there is a Firestore. */
const PERMANENT_CODES = new Set([
    'permission-denied',    // a rule said no
    'invalid-argument',     // undefined, NaN, a nested array
    'not-found',
    'already-exists',
    'failed-precondition',
    'out-of-range',
    'unauthenticated',      // permanent until somebody signs in again
    'data-loss',
]);

const TRANSIENT_CODES = new Set([
    'unavailable',          // offline, or the service is down
    'deadline-exceeded',
    'aborted',              // a contended transaction; retrying is the fix
    'resource-exhausted',   // rate limited — back off and try again
    'internal',
    'cancelled',
    'unknown',
]);

/** A browser storage quota failure, which every engine spells differently. */
function isQuotaError(error) {
    if (!error) return false;
    const name = error.name ?? '';
    return name === 'QuotaExceededError'
        || name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || error.code === 22
        || error.code === 1014
        || /quota/i.test(error.message ?? '');
}

/**
 * @param {Error & {code?: string}} error
 * @returns {{permanent: boolean, reason: string, advice: string}}
 */
export function classifyWriteError(error) {
    const code = typeof error?.code === 'string' ? error.code : null;

    if (isQuotaError(error)) {
        return {
            permanent: true,
            reason: 'out-of-space',
            advice: 'There is no room left to save. Save your work to a file, then clear old seasons.',
        };
    }

    if (code && PERMANENT_CODES.has(code)) {
        return {
            permanent: true,
            reason: code,
            advice: code === 'permission-denied' || code === 'unauthenticated'
                ? 'You are not allowed to change this. Sign in, or copy it to a board of your own.'
                : 'The store refused this change and will refuse it again. Save your work to a file.',
        };
    }

    if (code && TRANSIENT_CODES.has(code)) {
        return { permanent: false, reason: code, advice: 'Still trying.' };
    }

    // Unknown failures are treated as transient, deliberately. Guessing
    // "permanent" on something we do not recognise stops the app trying on
    // what may well be a blip; guessing "transient" costs a few retries.
    return { permanent: false, reason: code ?? 'unknown', advice: 'Still trying.' };
}
