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
import { seasonScopedKey } from '../utils/appStorage';

export const STAGES = 'stages';

/** Every stage that lives here, by the storage key it used to have. */
export const STAGE_KEYS = ['rosterState', 'fa_state_v1', 'nfl_draft_board_state', 'prospects_v1'];

export const stageId = (base, seasonId) => `${seasonId ?? '_'}__${base}`;

export function openStages() {
    return repository.ready(STAGES);
}

/**
 * Moves a stage off its raw key, once.
 *
 * Looks for the season-scoped key first and the unscoped one after, which is
 * the order they were introduced. Whatever is found becomes the document and
 * the raw key is dropped, so this can only happen once per stage per season.
 */
function migrate(base, seasonId) {
    const candidates = [seasonScopedKey(base, seasonId), base];
    for (const key of candidates) {
        let raw = null;
        try { raw = localStorage.getItem(key); } catch { /* unreadable */ }
        if (raw == null) continue;

        let value = null;
        try { value = JSON.parse(raw); } catch { value = null; }
        try { localStorage.removeItem(key); } catch { /* ignore */ }
        if (value && typeof value === 'object') return value;
    }
    return null;
}

/**
 * A stage's state, or null when it has none.
 *
 * Synchronous, like every other read in the repository, and carrying the same
 * caveat: against a remote adapter it answers null until `openStages()` has
 * resolved. See `ensureLoaded` in repository.js.
 */
export function readStage(base, seasonId) {
    const id = stageId(base, seasonId);
    const doc = repository.get(STAGES, id);
    if (doc) return doc.value ?? null;

    const migrated = migrate(base, seasonId);
    if (migrated) {
        writeStage(base, seasonId, migrated);
        return migrated;
    }
    return null;
}

export function writeStage(base, seasonId, value) {
    const id = stageId(base, seasonId);
    return repository.set(STAGES, id, { id, stage: base, seasonId: seasonId ?? null, value });
}

export function removeStage(base, seasonId) {
    return repository.remove(STAGES, stageId(base, seasonId));
}

/** Everything belonging to one season — what a rollback has to take with it. */
export function removeSeasonStages(seasonId) {
    return Promise.all(STAGE_KEYS.map(base => removeStage(base, seasonId)));
}
