/**
 * The stages — roster, free agency, the draft, the prospect pool — as
 * documents.
 *
 * They were the four stores that never went through the repository: single
 * JSON blobs on raw localStorage keys, written with `setItem` and parsed on
 * the way back. That made the adapter seam a half-truth. Swapping the backend
 * moved players, boards, seasons, authors and evaluations, and left these four
 * sitting in the browser whatever the configuration said.
 *
 * One document per stage per season, in one collection. The shape each stage
 * stores is unchanged — this is about WHERE it lives, not what it looks like —
 * so the parsing, the versioning and the CSV round trips are all untouched.
 *
 * What this does NOT do, and should not be mistaken for: it is not per-player
 * granularity. Two people editing one roster still write the same document and
 * the last one wins. That matters for BOARDS, where two analysts move
 * different players at once, and it is a separate change to a different
 * collection. This one is about making the backend swappable at all.
 */
import { repository } from './repository';

/**
 * A season's stages are a collection of its own.
 *
 *     seasons/{seasonId}/stages/{base}
 *
 * The key was `{season}__{base}` in one shared collection, and the document
 * then repeated all of it: `id`, `stage` and `seasonId` were the whole key and
 * both of its halves, written into every body.
 *
 * Nothing scans this collection — every read is an exact get — so the composite
 * key was never actually parsed, and on its own it was ugly rather than wrong.
 * What made it worth moving is that everything else season-scoped now lives
 * under the season, and one collection holding every season's stages is the
 * last thing standing between a season and being deletable as a subtree.
 */
export const stagesPath = (seasonId) => `seasons/${seasonId ?? '_'}/stages`;

/** Every stage that lives here, by the storage key it used to have. */
export const STAGE_KEYS = ['rosterState', 'fa_state_v1', 'nfl_draft_board_state', 'prospects_v1'];

/**
 * Loads a season's stages, so a synchronous read can answer for them.
 *
 * The last of the openers that returned a resolved promise and loaded nothing,
 * and the same fault as the other four: "loads on demand at its own path" is
 * true of localStorage, where loadSync fills a collection the instant anything
 * asks, and false of every other store.
 *
 * What lives here is `prospects_v1` — the players an analyst adds himself, for
 * somebody who declared late or was missed by every rankings file. Against
 * Firestore that read returned nothing, so a player added by one person reached
 * nobody: measured by writing one straight into the store and finding it absent
 * from another client's board.
 */
export function openStages(seasonId) {
    return seasonId ? repository.ready(stagesPath(seasonId)) : Promise.resolve();
}

/**
 * A stage's state, or null when it has none.
 *
 * Synchronous, like every other read in the repository, and carrying the same
 * caveat: against a remote adapter it answers null until `openStages()` has
 * resolved. See `ensureLoaded` in repository.js.
 */
export function readStage(base, seasonId) {
    return repository.get(stagesPath(seasonId), base)?.value ?? null;
}

export function writeStage(base, seasonId, value) {
    // The body is the value. It used to also carry `id`, `stage` and
    // `seasonId` — the whole key and both of its halves.
    return repository.set(stagesPath(seasonId), base, { value });
}

export function removeStage(base, seasonId) {
    return repository.remove(stagesPath(seasonId), base);
}

/** Everything belonging to one season — what a rollback has to take with it. */
export function removeSeasonStages(seasonId) {
    return Promise.all(STAGE_KEYS.map(base => removeStage(base, seasonId)));
}
