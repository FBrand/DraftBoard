/**
 * What an analyst has written about a player, kept outside boards.
 *
 * A board is a snapshot: where somebody had a player at one moment. Archiving
 * a season freezes it, tags included — "Dan liked him in 2026" is exactly the
 * artifact worth keeping.
 *
 * An evaluation is not a snapshot. It is a running log, and freezing a log
 * makes no sense while appending to one does. "Bends the corner" and "lost a
 * step after the knee" only contradict each other if you cannot see that they
 * were written a year apart — so every remark carries the season it was made
 * in, and the card shows it. That is also the thing worth saying out loud on a
 * broadcast: here is what he said then, here is what he says now.
 *
 * Remarks therefore live per AUTHOR and player, not per board. One man's view
 * of a player runs across every season he watches him, and the boards he built
 * along the way are separate artifacts that happen to reference the same
 * player. The consensus board has no author, so it owns its own remarks — see
 * ownerIdFor.
 */
import { repository } from '../data/repository';

export const EVALUATIONS = 'evaluations';

/**
 * Whose take this is. An author for a personal board; the board itself for
 * consensus, which has no person behind it and so is its own voice.
 */
export function ownerIdFor(board) {
    return board?.authorId ?? board?.id ?? null;
}

/** The three kinds, in the order a card shows them. */
export const REMARK_KINDS = ['strength', 'weakness', 'note'];

const KIND_CHAR = { strength: 's', weakness: 'w', note: 'n' };
const CHAR_KIND = { s: 'strength', w: 'weakness', n: 'note' };

/**
 * One document per owner, per player. The remarks are inside it.
 *
 *     evaluations/{playerId}/remarks/{ownerId}
 *       { "{seasonId}": { s: [["text", 1789418428790], …], w: […], n: […] } }
 *
 * The player comes first because of the read the app performs: the card shows
 * what EVERYBODY has written about one player, and on a read-only card that
 * stack is the card's content. Under the player that is one collection.
 *
 * Season and kind are object keys inside the document rather than more path
 * levels. Measured at a full season — 250 players scouted on five boards,
 * 17,500 remarks — splitting them out cost 183,750 characters of collection
 * key against 8,250 here, and bought nothing: nothing reads one kind of one
 * season without wanting its neighbours.
 *
 * A remark is `{ t: text, a: writtenAt }` in an array. It had a six-character
 * id of its own, which existed only to find it inside that array; the position
 * locates it just as well, and dropping it saves about 157,500 characters
 * across 17,500 remarks.
 *
 * It was briefly a two-element array, `[text, writtenAt]`, which is smaller
 * still — and **Firestore cannot store a nested array at all**. The emulator
 * refused it outright: "Nested arrays are not supported". A map inside an
 * array is the cheapest shape that both stores can hold.
 *
 * The cost of that is worth naming: a handle is an INDEX, so two browsers of
 * the same analyst editing the same player at the same moment could remove the
 * wrong line. The whole document is rewritten on any change in that case
 * anyway, so the race already existed; this makes it slightly worse in
 * exchange for a fifth of the collection.
 *
 * Total at that scale: 1,916,250 -> 1,507,000 characters, 21%.
 */
export const remarksPath = (playerId) => `${EVALUATIONS}/${playerId}/remarks`;

const NO_SEASON = '-';
const seasonKey = (seasonId) => seasonId ?? NO_SEASON;
const seasonOf = (key) => (key === NO_SEASON ? null : key);

/**
 * The handle a caller gets back and hands to removeRemark.
 *
 * Composed from where the remark sits rather than stored, so nothing is
 * written down twice. The owner is not in it: every caller that can remove a
 * remark already passes the owner separately.
 */
const handleFor = (seasonId, kind, index) => `${seasonKey(seasonId)}:${KIND_CHAR[kind]}:${index}`;

function readHandle(handle) {
    const [season, char, index] = String(handle ?? '').split(':');
    return { seasonId: seasonOf(season), kind: CHAR_KIND[char], index: Number(index) };
}

/**
 * Loads the remarks for the players named, so a synchronous read can answer.
 *
 * Takes ids rather than opening everything, because a remark collection is PER
 * PLAYER — `evaluations/{player}/remarks` — and there are seven hundred
 * players. Opening them all would be seven hundred reads to show one card.
 *
 * It used to be an empty function, on the reasoning that remarks "load on
 * demand under the player". Against localStorage that is true; `loadSync` fills
 * a collection the instant anything asks. Against a store that answers later,
 * `remarksFor` returns nothing for a player an analyst has written about — and
 * the shipped worked example then seeds itself into the same paths, where the
 * local overlay makes it WIN. A viewer opened a card and read the example
 * instead of the expert.
 */
export async function openEvaluations(playerIds) {
    const ids = playerIds == null ? [] : [].concat(playerIds).filter(Boolean);
    await Promise.all(ids.map(id => repository.ready(remarksPath(id))));
}

const docFor = (playerId, ownerId) => repository.get(remarksPath(playerId), ownerId) ?? {};

function expand(ownerId, doc) {
    const out = [];
    Object.entries(doc ?? {}).forEach(([sKey, kinds]) => {
        REMARK_KINDS.forEach(kind => {
            (kinds?.[KIND_CHAR[kind]] ?? []).forEach((r, index) => {
                if (!r || typeof r !== 'object') return;
                out.push({
                    id: handleFor(seasonOf(sKey), kind, index),
                    ownerId,
                    kind,
                    text: r.t,
                    seasonId: seasonOf(sKey),
                    createdAt: r.a ?? null,
                });
            });
        });
    });
    return out;
}

const byKindThenTime = (a, b) => (
    REMARK_KINDS.indexOf(a.kind) - REMARK_KINDS.indexOf(b.kind)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
);

/**
 * Every remark one owner has written about one player, across every season.
 *
 * Deliberately not filtered by season: an evaluation is a running log, and
 * "bends the corner" and "lost a step after the knee" only contradict each
 * other if you cannot see they were written a year apart.
 */
export function remarksFor(ownerId, playerId) {
    if (!ownerId || !playerId) return [];
    return expand(ownerId, docFor(playerId, ownerId)).sort(byKindThenTime);
}

/**
 * What everybody has written about one player, in one collection read.
 *
 * This is what the player-first address is for. The card was calling
 * remarksFor once per board that has ever existed.
 */
export function allRemarksFor(playerId) {
    if (!playerId) return [];
    const docs = repository.docs(remarksPath(playerId)) ?? {};
    const out = [];
    Object.entries(docs).forEach(([ownerId, doc]) => out.push(...expand(ownerId, doc)));
    return out;
}

/** The array a remark of this kind and season lives in, created if needed. */
function lineFor(doc, seasonId, kind) {
    const sKey = seasonKey(seasonId);
    const season = doc[sKey] ?? (doc[sKey] = {});
    const char = KIND_CHAR[kind];
    return season[char] ?? (season[char] = []);
}

function write(playerId, ownerId, doc) {
    // A season with no remarks left in it is not a season with three empty
    // lists; it is a season nobody has written about.
    Object.keys(doc).forEach(sKey => {
        Object.keys(doc[sKey]).forEach(char => {
            if (!doc[sKey][char].length) delete doc[sKey][char];
        });
        if (!Object.keys(doc[sKey]).length) delete doc[sKey];
    });

    const path = remarksPath(playerId);
    if (!Object.keys(doc).length) repository.remove(path, ownerId);
    else repository.set(path, ownerId, doc);
}

/**
 * Appends a remark, stamped with the season it is being made in — which is the
 * CURRENT season, not the season of whichever board is on screen. A note
 * written today is a note from today, even while looking back at an old board.
 */
export function addRemark(ownerId, playerId, kind, text, seasonId) {
    const body = String(text ?? '').trim();
    if (!ownerId || !playerId || !body || !REMARK_KINDS.includes(kind)) return null;

    const doc = structuredClone(docFor(playerId, ownerId));
    const line = lineFor(doc, seasonId ?? null, kind);
    const at = Date.now();
    line.push({ t: body, a: at });
    write(playerId, ownerId, doc);

    return {
        id: handleFor(seasonId ?? null, kind, line.length - 1),
        ownerId, kind, text: body, seasonId: seasonId ?? null, createdAt: at,
    };
}

/**
 * Corrects the wording. The season stamp is deliberately untouched: it records
 * when the remark was MADE, and fixing a typo doesn't move that.
 */
export function updateRemarkText(ownerId, playerId, handle, text) {
    const body = String(text ?? '').trim();
    if (!body) return removeRemark(ownerId, playerId, handle);

    const { seasonId, kind, index } = readHandle(handle);
    if (!kind || !Number.isInteger(index)) return false;

    const doc = structuredClone(docFor(playerId, ownerId));
    const line = doc[seasonKey(seasonId)]?.[KIND_CHAR[kind]];
    if (!line?.[index]) return false;

    line[index] = { t: body, a: line[index].a };
    write(playerId, ownerId, doc);
    return true;
}

export function removeRemark(ownerId, playerId, handle) {
    const { seasonId, kind, index } = readHandle(handle);
    if (!kind || !Number.isInteger(index)) return false;

    const doc = structuredClone(docFor(playerId, ownerId));
    const line = doc[seasonKey(seasonId)]?.[KIND_CHAR[kind]];
    if (!line?.[index]) return false;

    line.splice(index, 1);
    write(playerId, ownerId, doc);
    return true;
}
