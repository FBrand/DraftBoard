import { useMemo, useCallback } from 'react';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';

import { listBoards } from '../utils/boardRegistry';

/**
 * Which scouting board belongs to the rankings currently loaded.
 *
 * Draft and UDFA load one rankings file (via `?rankings=`), and each file has
 * a scouting board behind it. Showing tags from the wrong analyst's board
 * would be worse than showing none, so this matches on the filename rather
 * than assuming consensus.
 */
export function boardForCurrentRankings() {
    const boards = listBoards();
    const fallback = boards[0]?.id ?? null;
    try {
        const url = new URLSearchParams(window.location.search).get('board') ?? '';
        const match = boards.find(b => b.rankingsFile && url.includes(b.rankingsFile));
        return match?.id ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * Builds the id map alongside the existing fuzzy index — a plain function,
 * not a hook, so it's directly testable without rendering anything.
 */
export function loadTagIndex(entries) {
    const byId = new Map();
    entries.forEach((e, i) => { if (e.playerId) byId.set(e.playerId, i); });
    return { entries, index: buildNameIndex(entries), byId };
}

/**
 * The lookup itself, id-first — a plain function so the decision (not just
 * the data shape above) is directly testable too. This runs once per
 * rendered card on the Draft/UDFA board, a real render-loop path, not a
 * click handler: both sides already carry an id (the board pool's player,
 * and this board's entries) by the time this is called, so only fall back to
 * a fuzzy scan — an O(n) scan, versus an O(1) map lookup, which is the whole
 * reason to prefer the id path here specifically — when it genuinely can't
 * answer (no id on the qualifier, or a stale one).
 */
export function tagFor(name, qualifier, loaded) {
    if (!loaded.entries.length) return null;
    const idHit = qualifier?.id != null ? loaded.byId.get(qualifier.id) : undefined;
    const i = idHit !== undefined ? idHit : findMatchingIndex(name, loaded.index, qualifier);
    return i !== -1 && i !== undefined ? loaded.entries[i].tag ?? null : null;
}

/**
 * Returns `tagFor(name, player)` — the scouting tag for a player on the given
 * board,
 * so the draft board can draw the same markers Scouting does. Read-only; the
 * board is loaded once rather than watched, since tags are edited in Scouting
 * and this only needs to be right as of mount.
 */
export default function usePlayerTags(board = null) {
    const key = board ?? boardForCurrentRankings();

    // Memoise the data, not a closure over it — a useMemo that returns a
    // function defeats the React compiler's memoisation checks.
    const loaded = useMemo(() => {
        const entries = key ? scoutingState.loadState(key)?.entries ?? [] : [];
        return loadTagIndex(entries);
    }, [key]);

    return useCallback((name, qualifier) => tagFor(name, qualifier, loaded), [loaded]);
}
