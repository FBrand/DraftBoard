import { useEffect, useState } from 'react';
import { parseRankings } from '../utils/dataParser';
import * as scoutingState from '../utils/scoutingState';

const { BOARDS, BOARD_RANKINGS } = scoutingState;

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
// The rankings files are static, so they're fetched and parsed once per page
// load and shared by every caller. Without this, each mount of Scouting or of
// an info card refetched and reparsed all three — which is both wasteful and
// slow enough to have pushed a test over its timeout.
let poolsPromise = null;

function loadPools() {
    if (poolsPromise) return poolsPromise;
    const base = import.meta.env.BASE_URL;

    poolsPromise = Promise.all(BOARDS.map(async (board) => {
        try {
            const res = await fetch(`${base}${BOARD_RANKINGS[board]}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const players = parseRankings(await res.text()) || [];
            return [board, players.filter(p => p?.name)];
        } catch {
            // Cached as null so a missing file falls back per caller rather
            // than being retried on every mount.
            return [board, null];
        }
    })).then(entries => {
        const pools = Object.fromEntries(entries);
        // A `*` in a rankings file becomes a real `like` tag on that board, so
        // the star and the tag are one mechanic rather than two that can
        // disagree. Runs once per load, and only adds entries for players that
        // don't have one — it can never overwrite an analyst's own tag.
        BOARDS.forEach(board => {
            if (pools[board]?.length) scoutingState.seedFavourites(board, pools[board]);
        });
        return pools;
    });

    return poolsPromise;
}

export default function useBoardRankings(fallback) {
    const [pools, setPools] = useState(null);

    useEffect(() => {
        let cancelled = false;
        loadPools().then(loaded => { if (!cancelled) setPools(loaded); });
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
