/**
 * Athletic Matrix scores.
 *
 * These were per-board scouting fields, which was wrong: the matrix is a
 * measurement of the player, not one analyst's opinion of him. Dan and Ryan can
 * disagree about where he belongs on a board; they cannot disagree about his
 * athletic testing. Keeping a copy per board meant the same number had to be
 * typed three times and could silently drift apart.
 *
 * They now live where every other fact about a player lives — on his registry
 * record (see playerRegistry.js). This module stays as the way the app reads
 * and writes them, so callers don't have to care, and it carries across the
 * rows written while the scores had a store of their own.
 */
import { buildNameIndex, findMatchingIndex } from './nameMatcher';
import { factsFor, setFacts, resolve, loadRegistry } from './playerRegistry';

const LEGACY_KEY = 'athletic_matrix_v1';
export const STATE_VERSION = 1;

const FIELD = { total: 'athleticMatrixTotal', position: 'athleticMatrixPosition' };

function legacyRows() {
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.players) ? parsed.players : [];
    } catch {
        return [];
    }
}

/**
 * Moves scores from the old standalone store onto the registry.
 *
 * Rows whose player can't be identified yet are left where they are rather
 * than dropped: the registry fills up as the rankings load, so a later run may
 * well place them. Numbers somebody typed in are not worth losing to a race.
 */
export function migrateLegacyScores() {
    const rows = legacyRows();
    if (!rows.length) return false;

    const registry = loadRegistry();
    if (!registry.length) return false;
    const index = buildNameIndex(registry);

    const unplaced = [];
    let moved = 0;

    rows.forEach(row => {
        let id = row.playerId ?? null;
        if (!id) {
            const at = findMatchingIndex(row.name, index, { position: row.pos });
            id = at === -1 ? null : registry[at].id;
        }
        if (!id) { unplaced.push(row); return; }
        setFacts(id, { athleticMatrixTotal: row.total, athleticMatrixPosition: row.position });
        moved += 1;
    });

    try {
        if (unplaced.length) {
            localStorage.setItem(LEGACY_KEY, JSON.stringify({ version: STATE_VERSION, players: unplaced }));
        } else {
            localStorage.removeItem(LEGACY_KEY);
        }
    } catch { /* ignore */ }

    return moved > 0;
}

/** Resolves without inventing a record: reading a score must not create a player. */
function idFor(name, qualifier) {
    if (qualifier?.id) return qualifier.id;
    if (!name) return null;
    return resolve({ name, position: qualifier?.position, school: qualifier?.school }, { create: false });
}

/** `{ total, position }` for a player, or nulls when nothing is recorded. */
export function getScores(name, qualifier = null) {
    const id = idFor(name, qualifier);
    if (!id) return { total: null, position: null };
    const facts = factsFor(id);
    return { total: facts.athleticMatrixTotal, position: facts.athleticMatrixPosition };
}

/** Merges one field; passing null clears it. */
export function setScore(name, field, value, qualifier = null) {
    if (!name || !FIELD[field]) return;
    // Entering a score is a statement that this player exists, so unlike a
    // read this one may create the record.
    const id = qualifier?.id
        ?? resolve({ name, position: qualifier?.position, school: qualifier?.school });
    if (!id) return;
    setFacts(id, { [FIELD[field]]: value });
}

/**
 * Kept for callers that still rename by name. Scores hang off the registry id,
 * which survives a rename on its own, so there is nothing left to carry.
 */
export function renameScores() {
    return false;
}
