/**
 * Players added in the app, corrections to file players, and players hidden —
 * one document each, not one blob for all three.
 *
 * `prospects_v1` was a single stage document holding three arrays, and every
 * mutation read it, changed one element and wrote the whole thing back. Two
 * things are wrong with that, and only the second is about size.
 *
 * **Two experts adding a player lose one of them.** Both read the blob, both
 * append, both write; the second write carries the first's absence. Nothing
 * reports it, because from each browser the write succeeded and the player is on
 * the board — until a reload takes him off one of them. That is the same
 * whole-record-from-cache pattern the board's change marker had, and the same
 * fix: write the record, not the collection.
 *
 * **Collecting a subset should not mean scanning a key.** The three arrays are
 * read separately by every caller, which is this project's own test for whether
 * something wanted to be a collection (see data/boardEntries.js). So three of
 * them, rather than one collection with a type letter in the id.
 *
 *     seasons/{seasonId}/prospects/{id}          a player added here
 *     seasons/{seasonId}/prospect_edits/{key}    an override on a file player
 *     seasons/{seasonId}/prospect_hidden/{key}   a file player taken off
 *
 * Edits and hidden markers are keyed by the identity they are ABOUT, so hiding
 * the same player twice writes the same document rather than a second marker —
 * the array version had to search for one first, and a search that misses leaves
 * a duplicate nobody can remove.
 */
import { repository } from './repository';
import { identityKey } from '../utils/nameMatcher';

export const prospectsPath = (seasonId) => `seasons/${seasonId ?? '_'}/prospects`;
export const editsPath = (seasonId) => `seasons/${seasonId ?? '_'}/prospect_edits`;
export const hiddenPath = (seasonId) => `seasons/${seasonId ?? '_'}/prospect_hidden`;

/**
 * The document id for something said ABOUT a player, rather than a player.
 *
 * Name and position, from nameMatcher, plus the school where one is declared —
 * the identity rule this app already follows. Not a random id: the point is that
 * the same player resolves to the same document, so a correction replaces the
 * previous correction instead of stacking beside it.
 */
export const aboutKey = (identity) => {
    const base = identityKey(identity?.name ?? '', identity?.position ?? '');
    const school = String(identity?.school ?? '').trim().toLowerCase();
    return (school ? `${base}|${school}` : base).replace(/[/\s]+/g, '_');
};

export function openProspects(seasonId) {
    if (!seasonId) return Promise.resolve();
    return Promise.all([
        repository.ready(prospectsPath(seasonId)),
        repository.ready(editsPath(seasonId)),
        repository.ready(hiddenPath(seasonId)),
    ]);
}

const listOf = (path) => Object.entries(repository.docs(path) ?? {});

/** Players added here, each with the id of the document holding him. */
export const readProspects = (seasonId) =>
    listOf(prospectsPath(seasonId)).map(([id, doc]) => ({ ...doc, __id: id }));

/** Overrides, in the shape prospects.js already reads: `{ match, patch }`. */
export const readEdits = (seasonId) =>
    listOf(editsPath(seasonId)).map(([id, doc]) => ({ ...doc, __id: id }));

/** Identities taken off every board. */
export const readHidden = (seasonId) =>
    listOf(hiddenPath(seasonId)).map(([id, doc]) => ({ ...doc, __id: id }));

export const writeProspect = (seasonId, id, player) =>
    repository.set(prospectsPath(seasonId), id, player);

export const removeProspect = (seasonId, id) =>
    repository.remove(prospectsPath(seasonId), id);

export const writeEdit = (seasonId, match, patch) =>
    repository.set(editsPath(seasonId), aboutKey(match), { match, patch });

export const writeHidden = (seasonId, identity) =>
    repository.set(hiddenPath(seasonId), aboutKey(identity), identity);

export const removeHidden = (seasonId, identity) =>
    repository.remove(hiddenPath(seasonId), aboutKey(identity));

/** Everything this season holds, for scrapping it. */
export function removeAllProspects(seasonId) {
    const drop = (path) => Object.keys(repository.docs(path) ?? {})
        .map(id => repository.remove(path, id));
    return Promise.all([
        ...drop(prospectsPath(seasonId)),
        ...drop(editsPath(seasonId)),
        ...drop(hiddenPath(seasonId)),
    ]);
}
