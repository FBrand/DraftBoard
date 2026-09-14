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
import { byId } from '../utils/playerRegistry';

/**
 * The flat collection every board's entries USED to share. Kept only so that
 * a board saved by an older build is found once and moved.
 */
export const BOARD_ENTRIES = 'board_entries';

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

export function openBoardEntries() {
    // The legacy flat collection, so a board written by an older build can be
    // found and moved on first read. Per-board paths load on demand.
    return repository.ready(BOARD_ENTRIES);
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
    const path = entriesPath(boardId);
    const own = repository.docs(path) ?? {};
    if (Object.keys(own).length) return Object.entries(own).filter(([, doc]) => doc);

    const legacy = repository.docs(BOARD_ENTRIES) ?? {};
    const prefix = `${boardId}__`;
    const mine = Object.entries(legacy).filter(([id, doc]) => doc && id.startsWith(prefix));
    if (!mine.length) return [];

    const moved = mine.map(([id, doc]) => [id.slice(prefix.length), doc]);
    repository.commit(path, moved.map(([id, doc]) => ({ id, doc })));
    repository.commit(BOARD_ENTRIES, mine.map(([id]) => ({ id, doc: null })));
    return moved;
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
        const entry = { ...doc };
        delete entry.boardId;
        delete entry.order;
        // Pre-registry rows keep the name they were written with, because for
        // them it is the only identity there is.
        const playerId = doc.playerId ?? (id.startsWith('p_') ? id : null);
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
        if (!before || !same(filed(before), doc)) changes.push({ id, doc });
    });

    // Gone from the board — removed players, or a re-seed that dropped some.
    current.forEach((_doc, id) => { if (!seen.has(id)) changes.push({ id, doc: null }); });

    if (!changes.length) return Promise.resolve();
    return repository.commit(path, changes);
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
function filed(entry) {
    const out = { ...entry };
    delete out.id;
    delete out.boardId;
    delete out.order;
    if (out.playerId) {
        delete out.playerId;   // the key says it
        delete out.name;       // the registry says it
        delete out.school;
    }
    return out;
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
