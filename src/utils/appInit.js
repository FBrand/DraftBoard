/**
 * How the app populates itself on a first run.
 *
 * The shipped files in `public/` are not sample data — they are the real
 * offseason as it actually happened: `DraftBoard_Picks.csv` is the completed
 * draft, `roster.csv` the roster that came out of free agency, the draft and
 * UDFA signings. The default is therefore to load them, so a fresh browser
 * opens on the state the tool would be in if it had been used all offseason,
 * rather than on empty views that look broken.
 *
 * Two modes, chosen explicitly from the Session menu:
 *
 *   seeded (default) — every store loads its shipped file when it has nothing
 *                      saved yet. Re-choosing it discards local edits and
 *                      returns to the real current state.
 *   clean           — nothing seeds; every stage starts empty, for building a
 *                      season from scratch or demoing the flow.
 *
 * A store only ever seeds when it has no saved state, so ordinary edits are
 * never overwritten. `clean` has to be recorded rather than inferred from
 * "no data", because an empty board and a not-yet-loaded board look identical
 * in storage.
 */

const MODE_KEY = 'draftboard_init_mode';

import { repository } from '../data/repository';
import { ownedKeys } from './appStorage';

export const INIT_SEEDED = 'seeded';
export const INIT_CLEAN = 'clean';

export function getInitMode() {
    try {
        return localStorage.getItem(MODE_KEY) === INIT_CLEAN ? INIT_CLEAN : INIT_SEEDED;
    } catch {
        return INIT_SEEDED;
    }
}

/** True when a store with nothing saved should load its shipped file. */
export function shouldSeed() {
    return getInitMode() === INIT_SEEDED;
}

export function setInitMode(mode) {
    try {
        localStorage.setItem(MODE_KEY, mode === INIT_CLEAN ? INIT_CLEAN : INIT_SEEDED);
    } catch { /* ignore */ }
}

// Everything the app owns, minus the init mode itself — which has to survive
// the wipe, since it is what tells the reload which way to come back up.
// Shared with the session bundle — see appStorage.js. Keeping a second list
// here is what let the two drift: this one went on naming boards by analyst
// after their keys had become ids, so a clean slate left the boards behind.

/**
 * Wipes all app data and comes back up in `mode`. Callers reload afterwards;
 * the stores read their files during that fresh load.
 */
export function resetTo(mode) {
    ownedKeys().forEach(k => {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    // The repository keeps an in-memory copy, so clearing the keys underneath
    // it is not enough — without this the wiped collections would come
    // straight back from memory.
    repository.invalidate();
    setInitMode(mode);
}
