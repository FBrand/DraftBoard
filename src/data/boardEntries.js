/**
 * One document per player per board.
 *
 * A board was a single JSON blob: every placement on it in one value, rewritten
 * whole on every change. That is fine for one person and wrong for two. Two
 * analysts moving different players on the same board are two whole-blob
 * writes racing, and the later one wins with a copy that never saw the earlier
 * one — the exact failure `localAdapter`'s own header warns about.
 *
 * So an entry is a document, addressed by the board and the player. Moving
 * Arvell Reese writes Arvell Reese. Everything else on the board is untouched
 * and cannot be clobbered by somebody who happened to save a moment later.
 *
 * The state SHAPE the rest of the app sees is unchanged — `{ version, entries }`
 * in and out — because ten call sites read `state.entries` and none of them
 * care where it came from. What changed is that saving diffs, and writes only
 * what actually moved.
 */
import { repository } from './repository';
import { identityKey } from '../utils/nameMatcher';

// Named here rather than imported from boardRegistry, which already imports
// THIS module (removeBoardEntries) — taking it back the other way would
// close a cycle for the sake of one string.
const BOARDS = 'boards';
// The short name of boardFields.entriesStampedAt. Written straight onto the
// stored document, which is already in short form, so the renamer is not in
// the path here.
const ENTRIES_STAMP = 'u';
import { byId } from '../utils/playerRegistry';
import { entryFields } from './fieldNames';

/**
 * One board's entries, at a path of their own.
 *
 * `boards/b1/entries` is how Firestore spells "this board's placements", and
 * choosing it now rather than during the migration matters for three reasons:
 *
 *   - **A rule is written against a path.** "An expert may write his own
 *     board" is one line about `boards/{id}/entries`; over a shared collection
 *     with a boardId field it is a predicate that has to hold for every
 *     document a query might touch.
 *   - **Opening one board reads one board.** The flat collection meant loading
 *     five seasons of everybody's placements and filtering in memory. Against
 *     localStorage that is waste; against a network it is every request
 *     instead of one.
 *   - **The board stops being written into every key.** The path carries it,
 *     so the document id is just the player — 78 characters down to 38.
 */
export const entriesPath = (boardId) => `boards/${boardId}/entries`;

/**
 * Loads the named boards' entries, so a synchronous read can answer for them.
 *
 * This used to return a resolved promise and do nothing, on the reasoning that
 * entries "load on demand at their own path". Against localStorage that holds —
 * `loadSync` fills the collection the instant anything reads it. Against a
 * remote store it is the difference between following a broadcast and not:
 * `hasEntries()` reads synchronously, an unloaded collection answers "no
 * entries", and the CSV is then seeded over the top of the board that was
 * already there. Because the local overlay wins over the shared store, the
 * viewer kept that copy for good — Firestore said round 1, his screen said
 * round 6, and nothing the expert did ever reached him.
 *
 * Takes the ids rather than fetching the board list itself: boardRegistry
 * imports this module, and reaching back into it would close the cycle.
 */
export function openBoardEntries(boardIds) {
    const ids = boardIds == null ? [] : [].concat(boardIds).filter(Boolean);
    return Promise.all(ids.map(id => repository.ready(entriesPath(id))));
}

/**
 * The document id for one player on one board.
 *
 * The registry id when there is one, because that is the app's answer to "who
 * is this" and survives a correction to his name. Falling back to the identity
 * key — name folded for punctuation and case, plus base position — which is
 * the same thing nameMatcher uses to decide two entries are the same man.
 */
export function entryDocId(boardId, entry) {
    return entry.playerId || identityKey(entry.name, entry.position);
}

/**
 * The documents on one board, moving them off the shared collection if that is
 * still where they are.
 *
 * Read once, rewritten at the board's own path, and dropped from the old one —
 * the same shape of migration the roster used moving from a stage blob to
 * rows. It runs at most once per board, because after it the old collection
 * has nothing under that prefix.
 */
function onBoard(boardId) {
    const own = repository.docs(entriesPath(boardId)) ?? {};
    return Object.entries(own).filter(([, doc]) => doc);
}

/**
 * Every entry on a board, in the board's own order.
 *
 * Three things are put back here rather than stored:
 *
 * `playerId` and the board are the document key. `name` and `school` are the
 * registry's — they were copied onto all 984 entries, which is 49KB of a
 * second answer to "who is this" that a rename leaves behind. The registry is
 * loaded before any board is read, so this costs a map lookup.
 *
 * The order is DERIVED from round and withinGroup instead of stored beside
 * them. A stored order is a second ordering that can disagree with the tiers
 * it sits next to, and the board already has an opinion about where everybody
 * goes; players nobody has placed sort last, which is what `???` means.
 */
export function readEntries(boardId) {
    const entries = onBoard(boardId).map(([id, doc]) => {
        // Long names in the app, short ones in the store — field names were
        // 40% of this collection. See fieldNames.js.
        const entry = entryFields.fat(doc);
        delete entry.boardId;
        delete entry.order;
        const playerId = id;
        if (playerId) {
            entry.playerId = playerId;
            const record = byId(playerId);
            if (record) {
                entry.name = record.name;
                if (record.school) entry.school = record.school;
            }
        }
        return entry;
    });

    const key = (e) => [
        e.round ?? Number.MAX_SAFE_INTEGER,
        e.tier ?? 0,
        e.withinGroup ?? Number.MAX_SAFE_INTEGER,
    ];
    return entries.sort((a, b) => {
        const ka = key(a), kb = key(b);
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
        return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
}

export function hasEntries(boardId) {
    return onBoard(boardId).length > 0;
}

/**
 * Writes a board's entries, touching only the ones that differ.
 *
 * The diff is what makes this worth doing. Handed a whole board — which is
 * what every caller has — it works out which players actually changed and
 * commits those. A tier drag becomes one document; a re-seed becomes all of
 * them, in one batch.
 */
export function writeEntries(boardId, entries) {
    // Keyed by the map key, not by an `id` field — the document no longer
    // carries one. It was `boardId__playerId`, both of which are already
    // fields, written 984 times: 42KB of saying the same thing three ways.
    const path = entriesPath(boardId);
    const current = new Map(onBoard(boardId));

    const changes = [];
    const seen = new Set();

    entries.forEach((entry) => {
        const id = entryDocId(boardId, entry);
        seen.add(id);
        const doc = filed(withoutNulls(entry));
        const before = current.get(id);
        // Compared by value: a board is re-saved wholesale on every edit, and
        // writing 328 identical documents because one of them moved is the
        // thing this exists to stop.
        if (!before || !same(before, doc)) changes.push({ id, doc });
    });

    // Gone from the board — removed players, or a re-seed that dropped some.
    current.forEach((_doc, id) => { if (!seen.has(id)) changes.push({ id, doc: null }); });

    if (!changes.length) return Promise.resolve();

    // Stamp the board so other devices can tell, for one already-cached
    // document, whether these 328 are worth re-reading.
    //
    // Without it the only way to know whether a board changed is to fetch it
    // and look, which costs the whole collection every time somebody opens
    // the Draft board — paid in full on the overwhelmingly common case where
    // nothing changed at all. `boards` is followed (see followBoards), so the
    // stamp arrives live at no extra read, and the comparison is free.
    //
    // In the SAME batch as the entries, not after them: two writes could land
    // apart, and a stamp that moved while the entries did not would tell
    // every other device to re-read for nothing, while entries that moved
    // without the stamp would leave them all reading a stale board and never
    // finding out. Atomicity is what makes the marker trustworthy rather than
    // merely usually right.
    //
    // Only when something really changed — the early return above means an
    // idle save does not stamp, so it does not wake anybody up.
    const board = repository.get(BOARDS, boardId);
    const items = changes.map(c => ({ collection: path, id: c.id, doc: c.doc }));
    if (board) {
        items.push({
            collection: BOARDS,
            id: boardId,
            doc: { ...board, [ENTRIES_STAMP]: Date.now() },
        });
    }
    return repository.commitMany(items);
}

/**
 * A field with no value is left out rather than written as null.
 *
 * An entry declares fourteen fields and most players have a value for six of
 * them. The two athletic-matrix scores were null on all 984 entries in the
 * shipped season — 55KB of the word "null" — because the matrix is a
 * measurement of the PLAYER and lives in its own store; the fields here exist
 * for the rare board that overrides one. tag, tier and round are null for
 * everybody nobody has got to yet.
 *
 * Safe because every reader already asks with a default: `entry?.tag ?? null`,
 * `e?.round != null`. Absent and null have always been the same answer to
 * them; only the storage disagreed. And the diff below compares `x ?? null`,
 * so an entry that loses a null does not read as changed.
 */
/**
 * When the entry was last touched, as epoch milliseconds.
 *
 * An ISO string is 24 characters of which 13 carry information, and there were
 * 984 of them. It is read in two places — the board CSV, and the one-time
 * migration of remarks off board entries — and both want a date, which this
 * still is.
 */
function stamp(value) {
    if (typeof value === 'number') return value;
    const ms = Date.parse(value ?? '');
    return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * An entry reduced to what is actually written.
 *
 * Out goes everything the key or the registry already states. `position` stays
 * — it is an OPINION, and two analysts labelling the same player DL and EDGE
 * are not disagreeing about a fact. `name` stays only for a row with no
 * playerId, where it is the last thing identifying him.
 */
/**
 * The document for one entry: the fields an entry declares, and nothing else.
 *
 * A whitelist rather than a blacklist, because `entryFields.lean()` passes a
 * key it does not recognise straight through under its LONG name. The app hands
 * this whole player objects — `saveEntry` spreads the display shape over the
 * stored one — so an edit wrote `strengths`, `weaknesses` and `notes` onto a
 * PLACEMENT document, as empty arrays, spelled out in full. Remarks moved to
 * evaluations/{player}/remarks precisely so they would stop riding along on
 * boards, and field names were 40% of this collection before they were
 * shortened — the biggest one in the app at 984 documents.
 *
 * Deleting the three known offenders would have fixed today's leak and left the
 * next one to be found in production. What belongs in this document is a
 * question the document should answer.
 */
const DECLARED = new Set(Object.keys(entryFields.map));

function filed(entry) {
    const out = {};
    Object.entries(entry ?? {}).forEach(([k, v]) => { if (DECLARED.has(k)) out[k] = v; });
    // playerId, name and school are deliberately absent: the key says who this
    // is, and the registry says what he is called.
    return entryFields.lean(out);
}

function withoutNulls(entry) {
    const out = {};
    Object.entries(entry).forEach(([k, v]) => { if (v !== null && v !== undefined) out[k] = v; });
    if (out.updatedAt !== undefined) out.updatedAt = stamp(out.updatedAt);
    return out;
}

function same(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const x = a[k], y = b[k];
        if (x === y) continue;
        if (Array.isArray(x) && Array.isArray(y)) {
            if (x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
            continue;
        }
        if ((x ?? null) !== (y ?? null)) return false;
    }
    return true;
}

/** Drops a whole board — what scrapping a season has to do to each of its boards. */
export function removeBoardEntries(boardId) {
    const ids = onBoard(boardId).map(([id]) => id);
    if (!ids.length) return Promise.resolve();
    return repository.commit(entriesPath(boardId), ids.map(id => ({ id, doc: null })));
}
