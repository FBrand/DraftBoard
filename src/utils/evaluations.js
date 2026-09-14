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

/**
 * A remark is addressed, not described.
 *
 * Season and kind are part of the DOCUMENT ID rather than fields repeated on
 * every remark. A player scouted properly carries about fourteen of them, and
 * each was spending 52 bytes on a season id identical to its neighbours' and
 * 18 more spelling out one of three words — 70 of roughly 209 bytes saying
 * what the address could say once.
 *
 * So: `{ownerId}__{playerId}__{seasonId}__{s|w|n}`, and the document is a map
 * of short id to `[text, writtenAt]`.
 *
 * The ids are short on purpose. A remark id is not like a player id: it is a
 * handle used to find one remark inside one document, never referenced from
 * anywhere else, and it only has to be unique among the dozen-odd siblings in
 * its own map. Six base36 characters is ample, where a v4 uuid was 46 bytes.
 */
const KIND_CHAR = { strength: 's', weakness: 'w', note: 'n' };
const CHAR_KIND = { s: 'strength', w: 'weakness', n: 'note' };

const docId = (ownerId, playerId, seasonId, kind) =>
    `${ownerId}__${playerId}__${seasonId ?? '_'}__${KIND_CHAR[kind]}`;

/** The pre-season-in-the-path document: one per owner and player. */
const legacyDocId = (ownerId, playerId) => `${ownerId}__${playerId}`;

/** Unique among a dozen siblings, not among every remark ever written. */
function shortId(taken) {
    for (let i = 0; i < 50; i += 1) {
        const id = Math.random().toString(36).slice(2, 8);
        if (!taken.has(id)) return id;
    }
    return `${Date.now().toString(36)}`;
}

/**
 * The handle a caller gets back.
 *
 * Callers pass this to removeRemark and updateRemarkText, so it has to carry
 * everything needed to find the remark again — which, now that the address
 * holds the season and the kind, means the address. Composed rather than
 * stored: nothing is written down twice.
 */
const handleFor = (seasonId, kind, id) => `${seasonId ?? '_'}:${KIND_CHAR[kind]}:${id}`;

function readHandle(handle) {
    const [seasonId, char, id] = String(handle ?? '').split(':');
    return { seasonId: seasonId === '_' ? null : seasonId, kind: CHAR_KIND[char], id };
}

export async function openEvaluations() {
    await repository.ready(EVALUATIONS);
}

/**
 * This owner's documents about this player, found by their key.
 *
 * Deliberately a prefix scan rather than a loop over the seasons the registry
 * knows about. Two reasons, and the second is the one that matters: a season
 * that has been scrapped is no longer in the list, and its remarks are
 * supposed to outlive it — "what you learned about a player does not stop
 * being true because the board is gone" is the whole reason evaluations are
 * not owned by a season. Enumerating seasons would quietly make those
 * unreachable.
 */
function docsAbout(ownerId, playerId) {
    const all = repository.docs(EVALUATIONS) ?? {};
    const prefix = `${ownerId}__${playerId}__`;
    return Object.entries(all).filter(([id, doc]) => doc && id.startsWith(prefix));
}

/**
 * Pulls the season and kind back out of an address.
 *
 * Read from the RIGHT. Splitting on the separator does not work: a remark with
 * no season is filed under `_`, so the tail reads `___n` and splitting it on
 * `__` gives `['', '_n']` — the kind comes back as "_n", matches nothing, and
 * every unstamped remark silently vanishes on read while writing perfectly
 * well. The kind is always the last segment, so take it from the end.
 */
function addressOf(id, prefix) {
    const rest = id.slice(prefix.length);
    const cut = rest.lastIndexOf('__');
    if (cut === -1) return null;
    const season = rest.slice(0, cut);
    const char = rest.slice(cut + 2);
    if (!CHAR_KIND[char]) return null;
    return { seasonId: season === '_' ? null : season, kind: CHAR_KIND[char] };
}

/**
 * The legacy shape, read but never written.
 *
 * One document per owner and player, holding every remark in one array with
 * the season and kind spelled out on each. Converted the first time anything
 * writes — see `migrateIfNeeded` — so a card that is only ever looked at
 * costs nothing.
 */
function legacyRemarks(ownerId, playerId) {
    const doc = repository.get(EVALUATIONS, legacyDocId(ownerId, playerId));
    return Array.isArray(doc?.remarks) ? doc.remarks : [];
}

/**
 * Every remark this owner has written about this player, across every season.
 *
 * Deliberately not filtered by season: an evaluation is a running log, and
 * "bends the corner" and "lost a step after the knee" only contradict each
 * other if you cannot see they were written a year apart. The card groups them
 * by season, which is why each one still reports the season it came from.
 */
export function remarksFor(ownerId, playerId) {
    if (!ownerId || !playerId) return [];

    const legacy = legacyRemarks(ownerId, playerId);
    if (legacy.length) return legacy;

    const prefix = `${ownerId}__${playerId}__`;
    const out = [];
    docsAbout(ownerId, playerId).forEach(([id, doc]) => {
        const at = addressOf(id, prefix);
        if (!at) return;
        Object.entries(doc)
            .filter(([, v]) => Array.isArray(v))
            .forEach(([rid, [text, written]]) => {
                out.push({
                    id: handleFor(at.seasonId, at.kind, rid),
                    kind: at.kind,
                    text,
                    seasonId: at.seasonId,
                    createdAt: written ?? null,
                });
            });
    });
    // Kind order is what a card shows; within a kind, oldest first.
    return out.sort((a, b) => (
        REMARK_KINDS.indexOf(a.kind) - REMARK_KINDS.indexOf(b.kind)
        || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    ));
}

/** The stored map for one address, as it is on disk. */
function readMap(ownerId, playerId, seasonId, kind) {
    const doc = repository.get(EVALUATIONS, docId(ownerId, playerId, seasonId, kind));
    return doc && typeof doc === 'object' ? { ...doc } : {};
}

function writeMap(ownerId, playerId, seasonId, kind, map) {
    const id = docId(ownerId, playerId, seasonId, kind);
    if (!Object.keys(map).length) {
        repository.remove(EVALUATIONS, id);
        return;
    }
    repository.set(EVALUATIONS, id, map);
}

/**
 * Splits a legacy document into one per season and kind, once.
 *
 * Runs on the first write to a player whose remarks are still in the old
 * shape. Reading alone does not trigger it: converting on read would turn
 * opening a player card into a write, which is exactly the kind of thing that
 * fills a quota while somebody is only looking.
 */
function migrateIfNeeded(ownerId, playerId) {
    const legacy = legacyRemarks(ownerId, playerId);
    if (!legacy.length) return;

    const buckets = new Map();
    legacy.forEach(r => {
        const kind = REMARK_KINDS.includes(r.kind) ? r.kind : 'note';
        const key = `${r.seasonId ?? '_'}|${kind}`;
        if (!buckets.has(key)) buckets.set(key, { seasonId: r.seasonId ?? null, kind, rows: [] });
        buckets.get(key).rows.push(r);
    });

    buckets.forEach(({ seasonId, kind, rows }) => {
        const map = readMap(ownerId, playerId, seasonId, kind);
        const taken = new Set(Object.keys(map));
        rows.forEach(r => {
            const id = shortId(taken);
            taken.add(id);
            map[id] = [r.text, typeof r.createdAt === 'number' ? r.createdAt : Date.parse(r.createdAt) || Date.now()];
        });
        writeMap(ownerId, playerId, seasonId, kind, map);
    });

    repository.remove(EVALUATIONS, legacyDocId(ownerId, playerId));
}

/**
 * Appends a remark, stamped with the season it is being made in — which is the
 * CURRENT season, not the season of whichever board is on screen. A note
 * written today is a note from today, even while looking back at an old board.
 */
export function addRemark(ownerId, playerId, kind, text, seasonId) {
    const body = String(text ?? '').trim();
    if (!ownerId || !playerId || !body || !REMARK_KINDS.includes(kind)) return null;

    migrateIfNeeded(ownerId, playerId);

    const map = readMap(ownerId, playerId, seasonId ?? null, kind);
    const id = shortId(new Set(Object.keys(map)));
    const at = Date.now();
    map[id] = [body, at];
    writeMap(ownerId, playerId, seasonId ?? null, kind, map);

    return { id: handleFor(seasonId ?? null, kind, id), kind, text: body, seasonId: seasonId ?? null, createdAt: at };
}

/**
 * Corrects the wording. The season stamp is deliberately untouched: it records
 * when the remark was MADE, and fixing a typo doesn't move that. Nothing stops
 * somebody rewriting an old remark to look prescient — for three colleagues
 * that isn't a threat worth an audit trail, and showing the season beside
 * every remark makes it visible enough.
 */
export function updateRemarkText(ownerId, playerId, handle, text) {
    const body = String(text ?? '').trim();
    if (!body) return removeRemark(ownerId, playerId, handle);

    migrateIfNeeded(ownerId, playerId);
    const { seasonId, kind, id } = readHandle(handle);
    if (!kind) return false;

    const map = readMap(ownerId, playerId, seasonId, kind);
    if (!map[id]) return false;
    map[id] = [body, map[id][1]];
    writeMap(ownerId, playerId, seasonId, kind, map);
    return true;
}

export function removeRemark(ownerId, playerId, handle) {
    migrateIfNeeded(ownerId, playerId);
    const { seasonId, kind, id } = readHandle(handle);
    if (!kind) return false;

    const map = readMap(ownerId, playerId, seasonId, kind);
    if (!map[id]) return false;
    delete map[id];
    writeMap(ownerId, playerId, seasonId, kind, map);
    return true;
}

// The board fields remarks used to live in, back when they were bare strings
// and belonged to a board rather than to the person who wrote them.
const LEGACY_FIELDS = { strengths: 'strength', weaknesses: 'weakness', notes: 'note' };

/**
 * Moves a board's remarks onto its owner's evaluations, once.
 *
 * They were three arrays of strings on each entry, which meant they froze with
 * the board and were duplicated per season. Each becomes a remark stamped with
 * the season the board belongs to — the best available answer to "when was
 * this written", and right for anything written during that board's season.
 *
 * Returns the entries with the legacy fields stripped, or null if there was
 * nothing to move.
 */
export function migrateBoardRemarks(board, entries) {
    const ownerId = ownerIdFor(board);
    if (!ownerId || !entries?.length) return null;

    const carried = new Map();   // playerId -> remarks to append
    let found = false;

    const cleaned = entries.map(entry => {
        const hasLegacy = Object.keys(LEGACY_FIELDS).some(f => Array.isArray(entry[f]) && entry[f].length);
        if (!hasLegacy) return entry;
        found = true;

        // No player id means nothing to hang the remark on; leave the entry
        // alone rather than dropping what somebody wrote.
        if (!entry.playerId) return entry;

        const made = [];
        Object.entries(LEGACY_FIELDS).forEach(([field, kind]) => {
            (entry[field] ?? []).forEach(text => {
                const body = String(text ?? '').trim();
                if (!body) return;
                made.push({ kind, text: body });
            });
        });

        if (made.length) carried.set(entry.playerId, [...(carried.get(entry.playerId) ?? []), ...made]);

        const next = { ...entry };
        Object.keys(LEGACY_FIELDS).forEach(f => { delete next[f]; });
        return next;
    });

    if (!found) return null;

    // Through addRemark rather than a bulk write, so these land in the same
    // season-and-kind documents as everything else — there is no second path
    // into the store for them to diverge from.
    carried.forEach((remarks, playerId) => {
        remarks.forEach(r => addRemark(ownerId, playerId, r.kind, r.text, board.seasonId ?? null));
    });
    return cleaned;
}
