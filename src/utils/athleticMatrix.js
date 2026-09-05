/**
 * Athletic Matrix scores, keyed by player and shared across every board.
 *
 * These were per-board scouting fields, which was wrong: the matrix is a
 * measurement of the player, not one analyst's opinion of him. Dan and Ryan
 * can disagree about where he belongs on a board; they cannot disagree about
 * his athletic testing. Keeping a copy per board meant the same number had to
 * be typed three times and could silently drift apart.
 *
 * Stored separately from the scouting boards so it survives switching, and so
 * clearing one analyst's board doesn't take the measurements with it.
 */
import { buildNameIndex, findMatchingIndex } from './nameMatcher';

const STORAGE_KEY = 'athletic_matrix_v1';
export const STATE_VERSION = 1;

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { version: STATE_VERSION, players: [] };
        const parsed = JSON.parse(raw);
        if (typeof parsed?.version === 'number' && parsed.version > STATE_VERSION) {
            return { version: STATE_VERSION, players: [] }; // newer app wrote this
        }
        return { version: STATE_VERSION, players: Array.isArray(parsed?.players) ? parsed.players : [] };
    } catch {
        return { version: STATE_VERSION, players: [] };
    }
}

function save(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
    } catch { /* ignore */ }
}

export function loadAll() {
    return load().players;
}

/** `{ total, position }` for a player, or nulls when nothing is recorded. */
export function getScores(name, pos = null) {
    const players = load().players;
    if (!name || !players.length) return { total: null, position: null };
    // Matched by name the same way everything else is, so a rankings reload
    // or a slightly different spelling doesn't orphan the numbers.
    const i = findMatchingIndex(name, buildNameIndex(players), pos);
    if (i === -1) return { total: null, position: null };
    return { total: players[i].total ?? null, position: players[i].position ?? null };
}

/**
 * Follows a player's scores to a new name. Names are this app's identity key,
 * so correcting a misheard one has to carry the measurements across or they
 * are silently orphaned on a player who no longer exists.
 */
export function renameScores(oldName, newName, pos = null) {
    if (!oldName || !newName || oldName === newName) return;
    const state = load();
    const i = findMatchingIndex(oldName, buildNameIndex(state.players), pos);
    if (i === -1) return;
    state.players[i] = { ...state.players[i], name: newName };
    save(state);
}

/** Merges one field; passing null clears it. */
export function setScore(name, field, value, pos = null) {
    if (!name || (field !== 'total' && field !== 'position')) return;
    const state = load();
    const i = findMatchingIndex(name, buildNameIndex(state.players), pos);
    if (i === -1) state.players.push({ name, pos, total: null, position: null, [field]: value });
    else state.players[i] = { ...state.players[i], [field]: value };
    save(state);
}
