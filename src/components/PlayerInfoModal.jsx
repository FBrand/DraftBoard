import React, { useState, useMemo, useCallback } from 'react';
import ScoutingControls from './ScoutingControls';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import { rankBoard } from '../utils/boardRanking';
import useBoardRankings from '../hooks/useBoardRankings';

const { BOARDS, BOARD_LABELS } = scoutingState;

// Read-only player info card, opened by right-click / long-press on a player
// anywhere OUTSIDE Scouting — the draft board, UDFA, and the Roster/FA depth
// charts. Scouting is where evaluations get written; everywhere else this is
// a reference card you glance at mid-draft, so it never edits (an accidental
// long-press on air shouldn't be able to change a ranking).
//
// `player` may be a full player object (Draft/UDFA cards) or just
// `{ name, position }` (roster slots hold names, not player records).
// `players` is the full ranked pool, needed because total and position rank
// are DERIVED per board (see boardRanking.js) rather than stored: paging to
// another analyst's board has to re-rank the whole pool under that board's
// tiers and ordering, or the card would keep showing the loaded rankings'
// numbers no matter which board you were looking at.
export default function PlayerInfoModal({ player, players = [], onClose }) {
    const [activeBoard, setActiveBoard] = useState('consensus');
    const [boards] = useState(() => Object.fromEntries(BOARDS.map(b => [b, scoutingState.loadState(b)])));

    // Memoised: a fresh `?? []` each render would invalidate everything below
    // it, re-ranking the whole pool on every render.
    const entries = useMemo(() => boards[activeBoard]?.entries ?? [], [boards, activeBoard]);
    const entryIndex = useMemo(() => buildNameIndex(entries), [entries]);
    const entryFor = useCallback((name) => {
        const i = findMatchingIndex(name, entryIndex);
        return i !== -1 ? entries[i] : null;
    }, [entries, entryIndex]);

    // Each analyst ranks a different pool (their own rankings file), so paging
    // boards has to re-rank against that board's players — not re-rank one
    // shared list three times, which would give the same number every time.
    const { pools } = useBoardRankings(players);
    const pool = pools?.[activeBoard] ?? players;

    // Ranking the pool is the same work Scouting does for its own view; it's
    // recomputed only when the board changes, not on every render.
    const ranked = useMemo(() => rankBoard(pool, entryFor), [pool, entryFor]);
    const rankedIndex = useMemo(() => buildNameIndex(ranked), [ranked]);

    const resolved = useMemo(() => {
        if (!player) return null;
        const i = findMatchingIndex(player.name, rankedIndex);
        // Fall back to whatever the caller handed us — a roster slot can hold
        // someone who isn't in the rankings at all (an UDFA, a veteran).
        return i !== -1 ? ranked[i] : player;
    }, [player, ranked, rankedIndex]);

    if (!player) return null;

    const cycleBoard = (dir) => {
        const i = BOARDS.indexOf(activeBoard);
        setActiveBoard(BOARDS[(i + dir + BOARDS.length) % BOARDS.length]);
    };

    return (
        <ScoutingControls
            key={activeBoard}
            variant="modal"
            readOnly
            player={resolved}
            entry={entryFor(player.name)}
            onClose={onClose}
            boardLabel={BOARD_LABELS[activeBoard]}
            onPrevBoard={() => cycleBoard(-1)}
            onNextBoard={() => cycleBoard(1)}
        />
    );
}
