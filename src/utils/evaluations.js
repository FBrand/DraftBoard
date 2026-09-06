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

const docId = (ownerId, playerId) => `${ownerId}__${playerId}`;

const newId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `r_${crypto.randomUUID()}`;
    }
    return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/** The three kinds, in the order a card shows them. */
export const REMARK_KINDS = ['strength', 'weakness', 'note'];

export async function openEvaluations() {
    await repository.ready(EVALUATIONS);
}

export function remarksFor(ownerId, playerId) {
    if (!ownerId || !playerId) return [];
    return repository.get(EVALUATIONS, docId(ownerId, playerId))?.remarks ?? [];
}

function writeRemarks(ownerId, playerId, remarks) {
    const id = docId(ownerId, playerId);
    if (!remarks.length) {
        repository.remove(EVALUATIONS, id);
        return;
    }
    repository.set(EVALUATIONS, id, { id, ownerId, playerId, remarks });
}

/**
 * Appends a remark, stamped with the season it is being made in — which is the
 * CURRENT season, not the season of whichever board is on screen. A note
 * written today is a note from today, even while looking back at an old board.
 */
export function addRemark(ownerId, playerId, kind, text, seasonId) {
    const body = String(text ?? '').trim();
    if (!ownerId || !playerId || !body || !REMARK_KINDS.includes(kind)) return null;

    const remark = { id: newId(), kind, text: body, seasonId: seasonId ?? null, createdAt: new Date().toISOString() };
    writeRemarks(ownerId, playerId, [...remarksFor(ownerId, playerId), remark]);
    return remark;
}

/**
 * Corrects the wording. The season stamp is deliberately untouched: it records
 * when the remark was MADE, and fixing a typo doesn't move that. Nothing
 * stops somebody rewriting an old remark to look prescient — for three
 * colleagues that isn't a threat worth an audit trail, and showing the season
 * beside every remark makes it visible enough.
 */
export function updateRemarkText(ownerId, playerId, remarkId, text) {
    const body = String(text ?? '').trim();
    const remarks = remarksFor(ownerId, playerId);
    const at = remarks.findIndex(r => r.id === remarkId);
    if (at === -1) return false;

    if (!body) return removeRemark(ownerId, playerId, remarkId);
    const next = [...remarks];
    next[at] = { ...next[at], text: body, updatedAt: new Date().toISOString() };
    writeRemarks(ownerId, playerId, next);
    return true;
}

export function removeRemark(ownerId, playerId, remarkId) {
    const remarks = remarksFor(ownerId, playerId);
    const next = remarks.filter(r => r.id !== remarkId);
    if (next.length === remarks.length) return false;
    writeRemarks(ownerId, playerId, next);
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
                made.push({
                    id: newId(),
                    kind,
                    text: body,
                    seasonId: board.seasonId ?? null,
                    createdAt: entry.updatedAt ?? new Date().toISOString(),
                });
            });
        });

        if (made.length) carried.set(entry.playerId, [...(carried.get(entry.playerId) ?? []), ...made]);

        const next = { ...entry };
        Object.keys(LEGACY_FIELDS).forEach(f => { delete next[f]; });
        return next;
    });

    if (!found) return null;

    carried.forEach((remarks, playerId) => {
        writeRemarks(ownerId, playerId, [...remarksFor(ownerId, playerId), ...remarks]);
    });
    return cleaned;
}
