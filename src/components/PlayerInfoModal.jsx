import React, { useState, useMemo, useCallback } from 'react';
import ScoutingControls from './ScoutingControls';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import { rankBoard } from '../utils/boardRanking';
import useBoardRankings from '../hooks/useBoardRankings';

import { allBoards, boardById, currentSeason, listSeasons } from '../utils/boardRegistry';
import { ownerIdFor, remarksFor, addRemark, removeRemark } from '../utils/evaluations';
import { resolve as resolvePlayer } from '../utils/playerRegistry';

// The player card, opened by right-click / long-press on a player anywhere
// OUTSIDE Scouting — the draft board, UDFA, and the Roster/FA depth charts.
//
// What it can edit depends on the STAGE it was opened from, because the two
// kinds of correction belong to different stages.
//
// On Draft and UDFA you are working the class: the board is the subject, so a
// round, a tier or a tag is exactly the thing you reach for, and `editsOpinions`
// is set. On the Roster and in Free Agency you are looking at one player out
// of context, where re-ranking him on somebody's draft board is not a thing
// you do from a depth chart — there the useful correction is a fact: his
// school is wrong, he was a fourth-rounder not a third, he came from
// Tennessee. Facts are editable on every stage; opinions only where a board
// is what you are looking at.
//
// Scouting does not use this card at all — it has the whole board on screen
// and edits opinions in its own docked panel.
//
// EVALUATIONS are the exception, and they are not an inconsistency. A remark
// is not a placement: it belongs to the author rather than the board, it is
// stamped with the season it was made in, and it goes on growing after the
// board that ranked the player is frozen. It is also the only way to say
// anything at all about a veteran, who was never in a draft class anybody
// here ranked — so +/-/• can be written from this card, on any player, while
// round and tier cannot.
//
// `player` may be a full player object (Draft/UDFA cards) or just
// `{ name, position }` (roster slots hold names, not player records).
// `players` is the full ranked pool, needed because total and position rank
// are DERIVED per board (see boardRanking.js) rather than stored: paging to
// another analyst's board has to re-rank the whole pool under that board's
// tiers and ordering, or the card would keep showing the loaded rankings'
// numbers no matter which board you were looking at.
export default function PlayerInfoModal({ player, players = [], onClose, editsOpinions = false }) {
    const [activeBoard, setActiveBoard] = useState(() => allBoards()[0]?.id ?? null);
    // Every board ever, not just this season's: a player card reaching back
    // into past scouting is the point of keeping old boards at all.
    const [boardList] = useState(() => allBoards());
    const [boards, setBoards] = useState(() => Object.fromEntries(boardList.map(b => [b.id, scoutingState.loadState(b.id)])));
    // Bumped when a remark is written, so the list re-reads. Remarks live in
    // their own collection, not in this component's state.
    const [remarkTick, setRemarkTick] = useState(0);


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
        // Name only — see the note on `resolved`. An entry records the
        // position THAT board gave him, which is exactly what may differ.
        const i = findMatchingIndex(name, entryIndex);
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

        // The id is the identity, so use it when both sides have one — an
        // exact hit, no fuzziness to get wrong.
        if (player.id) {
            const hit = ranked.find(p => p.id === player.id);
            if (hit) return hit;
        }

        // Otherwise match on the NAME ALONE. Position deliberately does not
        // qualify here: a player is labelled differently by different
        // analysts — Rueben Bain Jr is DL.3T on consensus and EDGE on both
        // personal boards — and passing him as a qualifier made the lookup
        // fail against any board that disagreed. The card then fell back to
        // the raw player, who carries no derived ranks, so his position rank
        // read "???" on a board that had in fact ranked him.
        //
        // This is the same rule useBoardRankings.joinKeyFor uses, and for the
        // same reason: "are these two different men" is not the question here,
        // "is this the same man on another analyst's board" is.
        const i = findMatchingIndex(player.name, rankedIndex);
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


    /**
     * Writes a correction to the board being paged to. Only reachable where
     * `editsOpinions` is set — see the note at the top.
     *
     * Placement here is round and tier only. A rank is a position in an
     * ordering, and this card shows one player out of context; moving him by
     * number would need the whole board, which Scouting has and this does not.
     */
    const saveEntry = useCallback((updated) => {
        if (!activeBoard || !resolved) return;
        const board = scoutingState.loadState(activeBoard);
        const entries = [...board.entries];

        const target = resolved;
        let at = target.id ? entries.findIndex(e => e.playerId === target.id) : -1;
        if (at === -1) at = findMatchingIndex(target.name, buildNameIndex(entries));

        const { personalRank: _drop, ...persisted } = updated;
        if (at !== -1) entries[at] = { ...entries[at], ...persisted };
        else {
            entries.push({
                ...scoutingState.makeEntry(target.name, target.position, target.school ?? '', target.id ?? null),
                ...persisted,
            });
        }

        const next = { ...board, entries };
        scoutingState.saveState(activeBoard, next);
        setBoards(prev => ({ ...prev, [activeBoard]: next }));
    }, [activeBoard, resolved]);

    // A veteran opened from the roster arrives as a bare { name, position } —
    // no id, because a depth-chart slot holds a name. He IS registered, so
    // resolving without creating finds him; a player genuinely unknown to the
    // registry simply gets no remarks rather than a new record minted behind
    // somebody's back.
    // By NAME, not by name and position — same rule as `resolved` above, and
    // it bites here for the same reason. A depth-chart row says "DL" while the
    // rankings file that created the record said "DL.3T", so qualifying by
    // position missed, the player had no id, and with no id there was no
    // remark handler and therefore no pencil: the roster card silently lost
    // the ability to write anything at all.
    const playerId = resolved?.id
        ?? (resolved ? resolvePlayer({ name: resolved.name }, { create: false }) : null);

    const ownerId = ownerIdFor(boardById(activeBoard));
    const remarks = useMemo(
        () => (ownerId && playerId ? remarksFor(ownerId, playerId) : []),
        // remarkTick is the dependency that matters — the store changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ownerId, playerId, remarkTick],
    );

    const handleAddRemark = useCallback((kind, text) => {
        if (!ownerId || !playerId) return;
        // Stamped with the CURRENT season, not the season of the board being
        // looked at: a note written today is a note from today.
        addRemark(ownerId, playerId, kind, text, currentSeason()?.id ?? null);
        setRemarkTick(t => t + 1);
    }, [ownerId, playerId]);

    const handleRemoveRemark = useCallback((remarkId) => {
        if (!ownerId || !playerId) return;
        removeRemark(ownerId, playerId, remarkId);
        setRemarkTick(t => t + 1);
    }, [ownerId, playerId]);

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
            activeBoardId={activeBoard}
            onClose={onClose}
            boardLabel={boardById(activeBoard)?.label ?? ''}
            onPrevBoard={() => cycleBoard(-1)}
            onNextBoard={() => cycleBoard(1)}
            onEntryChange={editsOpinions ? saveEntry : undefined}
            remarks={remarks}
            seasons={listSeasons()}
            onAddRemark={playerId ? handleAddRemark : undefined}
            onRemoveRemark={playerId ? handleRemoveRemark : undefined}
        />
    );
}
