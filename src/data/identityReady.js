/**
 * Waiting until there is somebody to file work under.
 *
 * Firebase restores a session from IndexedDB a moment after the page loads, so
 * `repository.identity()` is null for the first few hundred milliseconds of a
 * shared build. Anything that decides "this person has no chart" in that window
 * is deciding it about a person who has not been named yet — and a stage that
 * seeds on that answer ends up writing a fresh chart over a real one as soon as
 * the session arrives.
 *
 * The guard in depthChartStore refuses to FILE work without a scope, which stops
 * the damage at the store. This is the other half: a caller that is about to make
 * a decision waits for the answer rather than acting on the absence.
 *
 * Deliberately a subscription and not a poll: signing in is an event the app
 * already publishes, and a poll would still be running on a build with no auth at
 * all. Deliberately bounded, because auth can fail — and when it does, the honest
 * result is "still nobody", which callers must handle by waiting rather than by
 * seeding.
 */
import { repository } from './repository';

/** True the moment somebody can be named. Always true on a local build. */
export const identityKnown = () => repository.identity() != null;

/**
 * Resolves when somebody can be named, or when `timeout` runs out.
 *
 * @returns {Promise<boolean>} whether anybody is named by the end of it.
 */
export async function whenIdentityKnown({ timeout = 8000 } = {}) {
    if (identityKnown()) return true;
    // A store with no notion of identity at all — nothing to wait for.
    if (!repository.isLive()) return identityKnown();

    let stop = () => {};
    const arrived = new Promise((resolve) => {
        try {
            // Imported here rather than at the top: utils/auth pulls in the
            // Firebase SDK, and a local-only build must not load it at all.
            import('../utils/auth')
                .then(({ onAuthChange }) => {
                    stop = onAuthChange(() => { if (identityKnown()) resolve(true); });
                    // It may already have landed between the check above and
                    // the subscription being in place.
                    if (identityKnown()) resolve(true);
                })
                .catch(() => resolve(false));
        } catch { resolve(false); }
    });

    const timedOut = new Promise(resolve => setTimeout(() => resolve(false), timeout));
    const answer = await Promise.race([arrived, timedOut]);
    stop();
    return answer && identityKnown();
}
