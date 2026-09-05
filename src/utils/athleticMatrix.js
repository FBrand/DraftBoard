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

// Scores are keyed by registry id where the caller has one. The qualified
// name match behind it covers rows written before ids existed, and callers
// that only know a name.
function indexOf(players, name, qualifier) {
    if (qualifier?.id) {
        const byId = players.findIndex(p => p.playerId === qualifier.id);
        if (byId !== -1) return byId;
    }
    return findMatchingIndex(name, buildNameIndex(players), qualifier);
}

/** `{ total, position }` for a player, or nulls when nothing is recorded. */
export function getScores(name, qualifier = null) {
    const players = load().players;
    if (!name || !players.length) return { total: null, position: null };
    const i = indexOf(players, name, qualifier);
    if (i === -1) return { total: null, position: null };
    return { total: players[i].total ?? null, position: players[i].position ?? null };
}

/**
 * Follows a player's scores to a new name.
 *
 * A row carrying a registry id needs no help — the id survives the rename, so
 * the scores follow the player for free. This is for rows written before ids
 * existed, which are keyed by name and would otherwise be orphaned on a player
 * who no longer answers to it.
 */
export function renameScores(oldName, newName, qualifier = null) {
    if (!oldName || !newName || oldName === newName) return;
    const state = load();
    const i = indexOf(state.players, oldName, qualifier);
    if (i === -1) return;
    state.players[i] = { ...state.players[i], name: newName };
    save(state);
}

/** Merges one field; passing null clears it. */
export function setScore(name, field, value, qualifier = null) {
    if (!name || (field !== 'total' && field !== 'position')) return;
    const state = load();
    const i = indexOf(state.players, name, qualifier);
    if (i === -1) {
        state.players.push({
            playerId: qualifier?.id ?? null,
            name,
            pos: qualifier?.position ?? null,
            total: null,
            position: null,
            [field]: value,
        });
    } else {
        // Backfill the id onto a row that predates it, so the next lookup
        // takes the id path and the name stops mattering.
        state.players[i] = {
            ...state.players[i],
            playerId: state.players[i].playerId ?? qualifier?.id ?? null,
            [field]: value,
        };
    }
    save(state);
}
