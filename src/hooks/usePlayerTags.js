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
        return { entries, index: buildNameIndex(entries) };
    }, [key]);

    return useCallback((name, qualifier) => {
        if (!loaded.entries.length) return null;
        const i = findMatchingIndex(name, loaded.index, qualifier);
        return i !== -1 ? loaded.entries[i].tag ?? null : null;
    }, [loaded]);
}
