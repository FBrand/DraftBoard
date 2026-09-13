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
    'viewed_season_v1',        // which season is open (boardRegistry.js)
    'season_init_v1',          // which seasons have been set up (seasonInit.js)
];

/**
 * Families with one key per board or per collection. A prefix is still an
 * allowlist — it just names a shape instead of an instance.
 */
const PREFIXES = [
    'rosterState__',           // legacy, pre-stageStore: migrated on first read
    'fa_state_v1__',           // the same
    'nfl_draft_board_state__', // the same
    'prospects_v1__',          // the same
    'scouting_board_v1__',     // legacy, pre-boardEntries: migrated on first read
    'scouting_overlay_v1__',   // the same, when a board was its own name
    'db_',                     // repository collections (data/localAdapter.js)
];

/**
 * Where one board's work is stored. Here rather than in scoutingState because
 * boardRegistry needs it too — to drop a scrapped season's boards — and cannot
 * import scoutingState, which imports boardRegistry. Two copies of this string
 * is how the session bundle came to name boards that no longer existed.
 */
export const boardStateKey = (boardId) => `scouting_board_v1__${boardId}`;

/**
 * A stage's storage key, for one season.
 *
 * The roster, free agency, the draft and the prospect pool were single global
 * keys, so every season shared one of each: rolling over to 2027 left last
 * year's roster, last year's draft class and last year's picks sitting there,
 * and the new season was the old one wearing a different number.
 *
 * The base key with no season is what every existing save is called, so it is
 * kept as the unscoped form and migrated on first read — see `readSeasonScoped`.
 */
export const seasonScopedKey = (base, seasonId) => (seasonId ? `${base}__${seasonId}` : base);

/**
 * Reads a stage's state for a season, moving an old unscoped save into it the
 * first time. Returns the raw string or null.
 *
 * The migration is one-way and happens once: whatever was saved before seasons
 * were scoped belongs to the season that was current when it was written,
 * which is the one being asked for the first time this runs.
 */
export function readSeasonScoped(base, seasonId) {
    const key = seasonScopedKey(base, seasonId);
    try {
        const own = localStorage.getItem(key);
        if (own !== null) return own;
        if (key === base) return null;

        const legacy = localStorage.getItem(base);
        if (legacy === null) return null;
        localStorage.setItem(key, legacy);
        localStorage.removeItem(base);
        return legacy;
    } catch {
        return null;
    }
}

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

/**
 * Asks the browser not to evict this origin's data.
 *
 * localStorage survives a restart and a reboot, but by default a browser
 * treats it as *evictable*: under disk pressure Chrome may clear it, without
 * warning and without asking. For a tool whose entire state — every board,
 * every evaluation, a whole offseason — lives in localStorage and nowhere
 * else, that is the difference between a bad morning and a lost season.
 *
 * `persist()` asks for the "persistent" bucket instead, which a browser only
 * clears when the user does. Chrome grants it silently for a site the user
 * has engaged with; Firefox may prompt; Safari does not implement it. All
 * three failure modes are fine — this is a best effort on top of a working
 * app, so it never blocks startup and never reports anything.
 *
 * It is NOT a backup. Storage is per ORIGIN, so the same app served from
 * localhost and from a LAN address keeps two entirely separate sets of data,
 * and "clear browsing data" takes the lot either way. Session → Export Full
 * Session is the only copy that survives the browser being wrong.
 */
export function requestPersistentStorage() {
    try {
        navigator.storage?.persist?.().catch(() => {});
    } catch { /* not supported — the app works either way */ }
}
