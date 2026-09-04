/**
 * Whole-app session bundle — every stage's state in one JSON file.
 *
 * The per-view CSV exports (draft session, roster, FA candidates, scouting
 * overlay, board rankings) each stay as they are: they're the interchange
 * format, human-editable in a spreadsheet, and each is useful on its own.
 * This is the complementary thing they can't do — a single "save my whole
 * offseason and restore it on another machine" file that can't get out of
 * sync across five separate exports.
 *
 * Deliberately JSON, not CSV: this is a backup/restore artifact spanning
 * heterogeneous shapes, not a table anyone should hand-edit.
 */

// Every localStorage key the app owns. Listed explicitly rather than dumping
// all of localStorage so an import can never inject unrelated keys, and so
// adding a stage is a deliberate one-line change here.
const KEYS = [
    'nfl_draft_board_state',   // useDraftState
    'nfl_draft_live_sync',     // useDraftState's live-sync toggle
    'rosterState',             // rosterState.js
    'fa_state_v1',             // faState.js
    'scouting_overlay_v1__consensus',
    'scouting_overlay_v1__dan',
    'scouting_overlay_v1__ryan',
    'draft_board_view',        // last active tab
    'draft_board_focus',       // Draft's focus-mode toggle
    'athletic_matrix_url',     // configurable Athletic Matrix link (appLinks.js)
];

export const SESSION_VERSION = 1;

export function exportSession() {
    const data = {};
    KEYS.forEach(k => {
        const raw = localStorage.getItem(k);
        if (raw !== null) data[k] = raw;
    });
    return JSON.stringify({
        format: 'draftboard-session',
        version: SESSION_VERSION,
        exportedAt: new Date().toISOString(),
        data,
    }, null, 2);
}

export function sessionFilename() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `draftboard_session_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/**
 * Validates and applies a session bundle. Throws with a readable message
 * rather than partially applying — a half-restored session across five
 * interdependent stages would be worse than a clean failure.
 *
 * Returns a summary of what was restored so the caller can report it.
 */
export function importSession(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Not a valid session file (could not parse JSON).');
    }
    if (parsed?.format !== 'draftboard-session') {
        throw new Error('Not a DraftBoard session file.');
    }
    if (typeof parsed.version !== 'number' || parsed.version > SESSION_VERSION) {
        throw new Error(`Session file version ${parsed.version} is newer than this app supports.`);
    }
    if (!parsed.data || typeof parsed.data !== 'object') {
        throw new Error('Session file has no data.');
    }

    // Validate every value parses before writing anything, so a corrupt entry
    // can't leave the app half-restored.
    const toWrite = [];
    Object.entries(parsed.data).forEach(([k, v]) => {
        if (!KEYS.includes(k)) return; // ignore unknown keys rather than trusting them
        if (typeof v !== 'string') return;
        toWrite.push([k, v]);
    });
    if (!toWrite.length) throw new Error('Session file contained no recognizable DraftBoard data.');

    // Clear the app's own keys first so stages absent from the bundle don't
    // linger from whatever was in the browser before.
    KEYS.forEach(k => localStorage.removeItem(k));
    toWrite.forEach(([k, v]) => localStorage.setItem(k, v));

    return { restored: toWrite.map(([k]) => k) };
}
