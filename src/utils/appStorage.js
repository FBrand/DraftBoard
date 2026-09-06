/**
 * Every localStorage key the app owns — in ONE place.
 *
 * There were two lists: one in appSession.js for the export bundle, one in
 * appInit.js for a clean slate. Both were hand-maintained, and both rotted the
 * moment keys stopped being fixed strings. A board's key became
 * `scouting_board_v1__<board id>`, which no literal list can name, and the
 * lists went on confidently enumerating `scouting_overlay_v1__dan`. The result
 * was silent: exporting a session produced a file with no scouting boards in
 * it at all, and a clean slate left the boards behind.
 *
 * So the families that grow are matched by PREFIX rather than named. That
 * keeps the property the explicit list was there for — an import can only
 * write keys the app owns, never inject unrelated ones — while surviving keys
 * that don't exist until a board or a collection does.
 */

/** Fixed keys, one per thing. */
const EXACT = [
    'nfl_draft_board_state',   // useDraftState
    'nfl_draft_live_sync',     // useDraftState's live-sync toggle
    'rosterState',             // rosterState.js
    'fa_state_v1',             // faState.js
    'draft_board_view',        // last active tab
    'draft_board_focus',       // Draft's focus-mode toggle
    'athletic_matrix_url',     // configurable Athletic Matrix link (appLinks.js)
    'athletic_matrix_v1',      // matrix scores, before they became player facts
    'player_registry_v1',      // the registry, before players became documents
    'prospects_v1',            // players added, corrected or hidden in-app
    'position_value_v1',       // appSettings.js
    'session_team_v1',         // appSettings.js
];

/**
 * Families with one key per board or per collection. A prefix is still an
 * allowlist — it just names a shape instead of an instance.
 */
const PREFIXES = [
    'scouting_board_v1__',     // one per board (boardRegistry.js gives the id)
    'scouting_overlay_v1__',   // the same, when a board was its own name
    'db_',                     // repository collections (data/localAdapter.js)
];

/** Whether the app owns this key, and may therefore write it on import. */
export function isOwnedKey(key) {
    return EXACT.includes(key) || PREFIXES.some(p => key.startsWith(p));
}

/**
 * Every owned key PRESENT right now. Reads localStorage rather than returning
 * the definition, because the dynamic families only exist once something has
 * created them.
 */
export function ownedKeys() {
    const found = new Set();
    EXACT.forEach(k => {
        try { if (localStorage.getItem(k) !== null) found.add(k); } catch { /* ignore */ }
    });
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && PREFIXES.some(p => key.startsWith(p))) found.add(key);
        }
    } catch { /* ignore */ }
    return [...found];
}
