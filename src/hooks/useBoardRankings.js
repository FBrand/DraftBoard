import { useEffect, useState } from 'react';
import { parseRankings } from '../utils/dataParser';
import { BOARDS, BOARD_RANKINGS } from '../utils/scoutingState';

/**
 * Loads every analyst's rankings file once, so Scouting can show each board's
 * real player pool rather than laying all three overlays over whichever single
 * file the draft view happened to load.
 *
 * They are different boards, not different opinions about one list — different
 * players, tiers and order — so the pool has to switch with the board.
 *
 * Returns `{ pools, loading }` where `pools` is `{ consensus: [...], ... }`.
 * A board whose file is missing or unreadable falls back to `fallback` (the
 * already-loaded draft pool) so the view still works instead of going blank.
 */
export default function useBoardRankings(fallback) {
    const [pools, setPools] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const base = import.meta.env.BASE_URL;

        Promise.all(BOARDS.map(async (board) => {
            try {
                const res = await fetch(`${base}${BOARD_RANKINGS[board]}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const players = parseRankings(await res.text()) || [];
                return [board, players.filter(p => p?.name)];
            } catch {
                return [board, null];
            }
        })).then(entries => {
            if (!cancelled) setPools(Object.fromEntries(entries));
        });

        return () => { cancelled = true; };
    }, []);

    if (!pools) return { pools: null, loading: true };

    return {
        pools: Object.fromEntries(
            BOARDS.map(b => [b, pools[b]?.length ? pools[b] : fallback]),
        ),
        loading: false,
    };
}
