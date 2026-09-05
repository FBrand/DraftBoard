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

import { collectionKey } from '../data/localAdapter';
import { repository } from '../data/repository';
import { PLAYERS } from './playerRegistry';

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
const OWNED_KEYS = [
    'nfl_draft_board_state',
    'nfl_draft_live_sync',
    'rosterState',
    'fa_state_v1',
    'scouting_overlay_v1__consensus',
    'scouting_overlay_v1__dan',
    'scouting_overlay_v1__ryan',
    'draft_board_view',
    'draft_board_focus',
    // Matrix scores are measurements of players, not offseason decisions — but
    // a clean slate should still be clean, so they clear with everything else.
    'athletic_matrix_v1',
    // Players added in the app, and the identity record for every player the
    // app has seen. The registry re-derives itself from the rankings files on
    // the next load, so clearing it loses nothing that wasn't entered by hand.
    'prospects_v1',
    'player_registry_v1',              // the registry's shape before players were documents
    collectionKey(PLAYERS),            // and where it lives now
];

/**
 * Wipes all app data and comes back up in `mode`. Callers reload afterwards;
 * the stores read their files during that fresh load.
 */
export function resetTo(mode) {
    OWNED_KEYS.forEach(k => {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
    // The repository keeps an in-memory copy, so clearing the keys underneath
    // it is not enough — without this the wiped collections would come
    // straight back from memory.
    repository.invalidate();
    setInitMode(mode);
}
