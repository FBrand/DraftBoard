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
import { listSeasons } from './boardRegistry';

/** The pre-path collection. Read for migration; never written. */
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
 * Every part of a remark's identity is a path segment.
 *
 *     evaluations/{playerId}/{kind}/{ownerId}/{seasonId}/{remarkId}
 *
 * There is no composite key anywhere in it, which is the point. A composite
 * key earns nothing here: something always has to take it apart again, and
 * every part of this one is a thing you select BY — the card wants one
 * player's, the section wants one kind's, a board wants one author's, the log
 * wants one season's.
 *
 * The player comes first because of the read the app actually performs. The
 * card shows what everybody has written about one player — on a read-only card
 * that stack IS the card's content — so the player is the thing being selected
 * by, and everything else narrows within it.
 *
 * A document is one remark: `{ t: text, a: writtenAt }`. Nothing in it repeats
 * any of the five things the address already states, and the remark id is
 * short because it is a handle into one collection, never referenced from
 * outside it.
 */
export const remarksPath = (playerId, kind, ownerId, seasonId) =>
    `${EVALUATIONS}/${playerId}/${KIND_CHAR[kind]}/${ownerId}/${seasonId ?? NO_SEASON}`;

/**
 * "No season" needs a name, because a path segment cannot be empty.
 *
 * A dash rather than an underscore: the separators here are slashes so there
 * is no ambiguity left to create, but the same sentinel is used either side of
 * the move and an underscore reads as part of an id.
 */
const NO_SEASON = '-';

/** Unique among a dozen siblings, not among every remark ever written. */
function shortId(taken) {
    for (let i = 0; i < 50; i += 1) {
        const id = Math.random().toString(36).slice(2, 8);
        if (!taken.has(id)) return id;
    }
    return Date.now().toString(36);
}

/**
 * The handle a caller gets back, and hands to removeRemark.
 *
 * Composed from the address rather than stored, so nothing is written twice.
 * The owner is not in it: every caller that can remove a remark already passes
 * the owner separately.
 */
const handleFor = (seasonId, kind, id) => `${seasonId ?? '_'}:${KIND_CHAR[kind]}:${id}`;

function readHandle(handle) {
    const [seasonId, char, id] = String(handle ?? '').split(':');
    return { seasonId: seasonId === '_' ? null : seasonId, kind: CHAR_KIND[char], id };
}

export async function openEvaluations() {
    // Only the legacy collection. A player's remarks load on demand, which is
    // the point of filing them under the player.
    await repository.ready(EVALUATIONS);
}

// --- the shapes written by older builds, read but never written -------------

/** The very first shape: one document per owner and player, remarks in a list. */
function legacyFlat(ownerId, playerId) {
    const doc = repository.get(EVALUATIONS, `${ownerId}__${playerId}`);
    return Array.isArray(doc?.remarks) ? doc.remarks : [];
}

/** The second: a flat collection keyed owner, player, season, kind. */
function legacyComposite(ownerId, playerId) {
    const all = repository.docs(EVALUATIONS) ?? {};
    const prefix = `${ownerId}__${playerId}__`;
    const out = [];
    Object.entries(all).forEach(([id, doc]) => {
        if (!doc || !id.startsWith(prefix)) return;
        const rest = id.slice(prefix.length);
        const cut = rest.lastIndexOf('__');
        if (cut === -1) return;
        const kind = CHAR_KIND[rest.slice(cut + 2)];
        if (!kind) return;
        const season = rest.slice(0, cut);
        Object.entries(doc).forEach(([rid, pair]) => {
            if (!Array.isArray(pair)) return;
            out.push({
                id: handleFor(season === '_' ? null : season, kind, rid),
                kind, text: pair[0], seasonId: season === '_' ? null : season, createdAt: pair[1] ?? null,
            });
        });
    });
    return out;
}

function legacyRemarks(ownerId, playerId) {
    const flat = legacyFlat(ownerId, playerId);
    if (flat.length) return flat;
    return legacyComposite(ownerId, playerId);
}

// --- reading ----------------------------------------------------------------

/**
 * Which seasons to look in.
 *
 * With every part of the address a path segment, there is no key left to scan:
 * reading a player's remarks means visiting the collections they are in, and
 * that means knowing which seasons exist. Firestore cannot list subcollections
 * from a browser at all, so this cannot be fixed by asking the store.
 *
 * The consequence is worth stating plainly: remarks written in a season that
 * has since been SCRAPPED are no longer reachable, because a scrapped season
 * leaves the list. The previous shape, which scanned a key prefix, found them.
 * Nothing else about evaluations changed — they still outlive the board and
 * still outlive the season being archived — but rolling a season back now
 * takes its remarks out of view with it.
 */
function seasonCandidates() {
    return [...listSeasons().map(x => x.id), null];
}

function readMap(playerId, kind, ownerId, seasonId) {
    return repository.docs(remarksPath(playerId, kind, ownerId, seasonId)) ?? {};
}

function expand(playerId, kind, ownerId, seasonId) {
    const docs = readMap(playerId, kind, ownerId, seasonId);
    return Object.entries(docs)
        .filter(([, d]) => d && typeof d === 'object')
        .map(([id, d]) => ({
            id: handleFor(seasonId, kind, id),
            ownerId,
            kind,
            text: d.t,
            seasonId,
            createdAt: d.a ?? null,
        }));
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

    const legacy = legacyRemarks(ownerId, playerId);
    if (legacy.length) return legacy;

    const out = [];
    REMARK_KINDS.forEach(kind => {
        seasonCandidates().forEach(seasonId => {
            out.push(...expand(playerId, kind, ownerId, seasonId));
        });
    });
    return out.sort(byKindThenTime);
}

/**
 * What everybody has written about one player.
 *
 * The card was calling remarksFor once per board that has ever existed; this
 * is the same work with the owner as one more level to walk rather than a
 * separate pass over a shared collection.
 */
export function allRemarksFor(playerId, ownerIds = []) {
    if (!playerId) return [];
    const out = [];
    ownerIds.filter(Boolean).forEach(ownerId => {
        REMARK_KINDS.forEach(kind => {
            seasonCandidates().forEach(seasonId => {
                out.push(...expand(playerId, kind, ownerId, seasonId));
            });
        });
    });
    return out;
}

/**
 * Moves a player's remarks under him, once, on the first WRITE.
 *
 * Reading alone does not trigger it: converting on read would turn opening a
 * player card into a write, which is exactly how a quota fills while somebody
 * is only looking.
 */
function migrateIfNeeded(ownerId, playerId) {
    const legacy = legacyRemarks(ownerId, playerId);
    if (!legacy.length) return;

    legacy.forEach(r => {
        const kind = REMARK_KINDS.includes(r.kind) ? r.kind : 'note';
        const path = remarksPath(playerId, kind, ownerId, r.seasonId ?? null);
        const taken = new Set(Object.keys(repository.docs(path) ?? {}));
        const at = typeof r.createdAt === 'number' ? r.createdAt : (Date.parse(r.createdAt) || Date.now());
        repository.set(path, shortId(taken), { t: r.text, a: at });
    });

    // Both old addresses, whichever this came from.
    repository.remove(EVALUATIONS, `${ownerId}__${playerId}`);
    const all = repository.docs(EVALUATIONS) ?? {};
    const prefix = `${ownerId}__${playerId}__`;
    Object.keys(all).forEach(id => {
        if (id.startsWith(prefix)) repository.remove(EVALUATIONS, id);
    });
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

    const path = remarksPath(playerId, kind, ownerId, seasonId ?? null);
    const id = shortId(new Set(Object.keys(repository.docs(path) ?? {})));
    const at = Date.now();
    repository.set(path, id, { t: body, a: at });

    return { id: handleFor(seasonId ?? null, kind, id), ownerId, kind, text: body, seasonId: seasonId ?? null, createdAt: at };
}

/**
 * Corrects the wording. The season stamp is deliberately untouched: it records
 * when the remark was MADE, and fixing a typo doesn't move that.
 */
export function updateRemarkText(ownerId, playerId, handle, text) {
    const body = String(text ?? '').trim();
    if (!body) return removeRemark(ownerId, playerId, handle);

    migrateIfNeeded(ownerId, playerId);
    const { seasonId, kind, id } = readHandle(handle);
    if (!kind) return false;

    const path = remarksPath(playerId, kind, ownerId, seasonId);
    const doc = repository.get(path, id);
    if (!doc) return false;
    repository.set(path, id, { t: body, a: doc.a });
    return true;
}

export function removeRemark(ownerId, playerId, handle) {
    migrateIfNeeded(ownerId, playerId);
    const { seasonId, kind, id } = readHandle(handle);
    if (!kind) return false;

    const path = remarksPath(playerId, kind, ownerId, seasonId);
    if (!repository.get(path, id)) return false;
    repository.remove(path, id);
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
