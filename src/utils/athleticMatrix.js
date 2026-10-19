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
 */
import { factsFor, setFacts, resolve } from './playerRegistry';
export const STATE_VERSION = 1;

const FIELD = { total: 'athleticMatrixTotal', position: 'athleticMatrixPosition' };


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
