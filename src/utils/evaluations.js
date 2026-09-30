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
 * player. Nothing here takes a board, and nothing here can: a board is not a
 * party to the question "who said this".
 */
// Moved onto the layered store — the first collection to cross. Nothing
// outside this module reads evaluations, which is what makes it safe to move
// alone: a collection served by both stores would have two caches over one
// backend, and they would drift. See data/appStore.js.
import { store } from '../data/appStore';

export const EVALUATIONS = 'evaluations';

/**
 * Everyone who has written about this player, grouped by who they are.
 *
 * Grouped by VOICE, never by board. The card used to lay these out per board
 * and look each one up by the board's author, which meant an analyst's own
 * notes vanished from the stack the moment his voice stopped being the board's
 * — written, stored, acknowledged, and invisible. It also had no way to show
 * somebody who has written about a player without owning a board.
 *
 * Returns ids only. Turning an id into a name needs the authors collection,
 * and this module deliberately knows nothing about that — callers that display
 * already have it.
 */
export function voicesFor(playerId) {
    if (!playerId) return [];
    const docs = store.view(remarksPath(playerId));
    return Object.keys(docs)
        .sort()
        .map(voiceId => ({ voiceId, remarks: expand(voiceId, docs[voiceId]) }))
        .filter(v => v.remarks.length);
}

/**
 * Whose voice a remark written now is in: mine, always.
 *
 * This replaces asking the BOARD whose opinion it is, which was wrong twice
 * over. It was a key space holding two different kinds of thing with no
 * discriminator — an author id, or a board id when the board had no author —
 * and it derived authorship from the board while firestore.rules derives it
 * from the token. The two agree only when the board's author happens to equal
 * the writer's uid, which the shipped seed guaranteed would never happen: no
 * expert could write a single strength, weakness or note on any personal
 * board, and the refusal was shown on screen as though it had been saved.
 *
 * A remark is a person's opinion, not a board's. So the writer is the voice,
 * the rules already know who that is from the token, and ownsVoice collapses
 * to "is this me" — which also takes two document reads off the write path.
 *
 * With no backend there is no sign-in and the adapter answers with a stable
 * local identity, so the single user has one voice and keeps it.
 */
export function myVoice() {
    return store.backend.identity?.() ?? null;
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
/**
 * A remark's identity, which used to be WHERE IT SAT.
 *
 * `season:kind:index` named a position in an array, so every remark's id
 * changed the moment anything before it was removed: delete the first strength
 * and the second one's handle now points at the third. A card holding an id
 * from before the delete edits or removes the wrong remark, and the failure is
 * silent — the right number of remarks remain, with the wrong words in them.
 *
 * A remark is now written with an id of its own, stored as `n`.
 *
 * An INTEGER, and counted per document rather than drawn at random, because
 * this file is also where the local budget is spent: remarks are per player per
 * author and dominate it — a ten-expert season measures 3.12 MB against a 5 MB
 * ceiling. `"n":7` costs six characters where `"i":"r_3m1stz"` costs fifteen,
 * which across 17,500 remarks is the difference between 105 KB and 260 KB a
 * season. A remark document has exactly one writer — it is keyed by its
 * author — so a per-document counter needs no coordination to stay unique.
 *
 * The header of tests/unit/remarkStorage.test.js records the opposite decision,
 * taken earlier: the id "existed only to find it inside its own array, and
 * position does that". Position does FIND a remark. It does not survive its
 * neighbours being removed — delete the first strength and every later handle
 * points one place too early, so a card holding an id from before the delete
 * edits or removes the wrong remark, leaving the right NUMBER of remarks with
 * the wrong words in them. That is what the id buys, for six characters.
 *
 * Positional handles are still READ, because remarks written before this exist
 * and there is no migration pass; they gain an id whenever the document they
 * live in is next rewritten.
 */
const nextRemarkId = (doc) => {
    let top = 0;
    Object.values(doc ?? {}).forEach(kinds => Object.values(kinds ?? {}).forEach(line => {
        (line ?? []).forEach(r => { if (Number.isInteger(r?.n) && r.n > top) top = r.n; });
    }));
    return top + 1;
};

/** A positional handle, for remarks written before ids existed. */
const legacyHandle = (seasonId, kind, index) => `${seasonKey(seasonId)}:${KIND_CHAR[kind]}:${index}`;


/**
 * Finds a remark by handle: by its own id, or by position for an old one.
 *
 * Returns the line it lives in and its place in that line, because both
 * removing and rewording need the array itself.
 */
function locate(doc, handle) {
    const raw = String(handle ?? '');

    // An id of its own. Searched for rather than computed from, which is the
    // entire point: where it sits is no longer part of what it is.
    if (!raw.includes(':')) {
        for (const [sKey, kinds] of Object.entries(doc ?? {})) {
            for (const [char, line] of Object.entries(kinds ?? {})) {
                const at = (line ?? []).findIndex(r => String(r?.n ?? '') === raw);
                if (at !== -1) return { line, at, seasonId: seasonOf(sKey), kind: CHAR_KIND[char] };
            }
        }
        return null;
    }

    const [season, char, index] = raw.split(':');
    const kind = CHAR_KIND[char];
    const at = Number(index);
    if (!kind || !Number.isInteger(at)) return null;
    const line = doc?.[season]?.[char];
    if (!line?.[at]) return null;
    return { line, at, seasonId: seasonOf(season), kind };
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
    await Promise.all(ids.map(id => store.ready(remarksPath(id))));
}

const docFor = (playerId, ownerId) => store.view(remarksPath(playerId))[ownerId] ?? {};

function expand(ownerId, doc) {
    const out = [];
    Object.entries(doc ?? {}).forEach(([sKey, kinds]) => {
        REMARK_KINDS.forEach(kind => {
            (kinds?.[KIND_CHAR[kind]] ?? []).forEach((r, index) => {
                if (!r || typeof r !== 'object') return;
                out.push({
                    // Its own id, or where it sits for one written before ids.
                    id: r.n != null ? String(r.n) : legacyHandle(seasonOf(sKey), kind, index),
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
    const docs = store.view(remarksPath(playerId));
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

    // One write, and its fate is reported per change. A refusal no longer
    // becomes a document the next read hands back as though it were stored.
    const path = remarksPath(playerId);
    store.write([{ collection: path, id: ownerId, doc: Object.keys(doc).length ? doc : null }]);
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
    const n = nextRemarkId(doc);
    line.push({ n, t: body, a: at });
    write(playerId, ownerId, doc);

    return { id: String(n), ownerId, kind, text: body, seasonId: seasonId ?? null, createdAt: at };
}

/**
 * Corrects the wording. The season stamp is deliberately untouched: it records
 * when the remark was MADE, and fixing a typo doesn't move that.
 */
export function updateRemarkText(ownerId, playerId, handle, text) {
    const body = String(text ?? '').trim();
    if (!body) return removeRemark(ownerId, playerId, handle);

    const doc = structuredClone(docFor(playerId, ownerId));
    const found = locate(doc, handle);
    if (!found) return false;

    // The id and the timestamp survive a reworded remark: it is the same
    // remark, said better. An old one gains an id here, which is how a
    // document converts without a migration pass.
    const before = found.line[found.at];
    found.line[found.at] = { n: before.n ?? nextRemarkId(doc), t: body, a: before.a };
    write(playerId, ownerId, doc);
    return true;
}

export function removeRemark(ownerId, playerId, handle) {
    const doc = structuredClone(docFor(playerId, ownerId));
    const found = locate(doc, handle);
    if (!found) return false;

    found.line.splice(found.at, 1);
    write(playerId, ownerId, doc);
    return true;
}
