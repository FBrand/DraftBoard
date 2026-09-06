import React, { useState, useMemo, useCallback } from 'react';
import ScoutingControls from './ScoutingControls';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import { rankBoard } from '../utils/boardRanking';
import useBoardRankings from '../hooks/useBoardRankings';

import { allBoards, boardById } from '../utils/boardRegistry';

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
    const [activeBoard, setActiveBoard] = useState(() => allBoards()[0]?.id ?? null);
    // Every board ever, not just this season's: a player card reaching back
    // into past scouting is the point of keeping old boards at all.
    const [boardList] = useState(() => allBoards());
    const [boards] = useState(() => Object.fromEntries(boardList.map(b => [b.id, scoutingState.loadState(b.id)])));

    // Memoised: a fresh `?? []` each render would invalidate everything below
    // it, re-ranking the whole pool on every render.
    const entries = useMemo(() => boards[activeBoard]?.entries ?? [], [boards, activeBoard]);
    const entryIndex = useMemo(() => buildNameIndex(entries), [entries]);
    // By registry id where both sides have one; the qualified name match is
    // the fallback for entries written before ids existed.
    const entryById = useMemo(
        () => new Map(entries.filter(e => e.playerId).map(e => [e.playerId, e])),
        [entries],
    );
    const entryFor = useCallback((name, qualifier) => {
        if (qualifier?.id) {
            const hit = entryById.get(qualifier.id);
            if (hit) return hit;
        }
        const i = findMatchingIndex(name, entryIndex, qualifier);
        return i !== -1 ? entries[i] : null;
    }, [entries, entryIndex, entryById]);

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
        const i = findMatchingIndex(player.name, rankedIndex, player);
        // Fall back to whatever the caller handed us — a roster slot can hold
        // someone who isn't in the rankings at all (an UDFA, a veteran).
        return i !== -1 ? ranked[i] : player;
    }, [player, ranked, rankedIndex]);

    // Remarks from every board, shown together on the card — see BoardNotes.
    // Only the ranks and tags page with ‹/›; what an analyst wrote about a
    // player is worth seeing all at once.
    const allBoardNotes = useMemo(() => {
        if (!player) return [];
        return boardList.map(board => {
            const list = boards[board.id]?.entries ?? [];
            const i = findMatchingIndex(player.name, buildNameIndex(list));
            return { board: board.id, label: board.label, entry: i !== -1 ? list[i] : null };
        });
    }, [boards, boardList, player]);

    if (!player) return null;

    const cycleBoard = (dir) => {
        const ids = boardList.map(b => b.id);
        const i = ids.indexOf(activeBoard);
        setActiveBoard(ids[(i + dir + ids.length) % ids.length]);
    };

    return (
        <ScoutingControls
            key={activeBoard}
            variant="modal"
            readOnly
            player={resolved}
            entry={entryFor(player.name, player)}
            allBoardNotes={allBoardNotes}
            onClose={onClose}
            boardLabel={boardById(activeBoard)?.label ?? ''}
            onPrevBoard={() => cycleBoard(-1)}
            onNextBoard={() => cycleBoard(1)}
        />
    );
}
