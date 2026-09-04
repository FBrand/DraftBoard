import React, { useState, useMemo, useRef } from 'react';
import CenterBoard from './CenterBoard';
import ScoutingControls from './ScoutingControls';
import ScoutingLeftPanel from './ScoutingLeftPanel';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import useIsMobile from '../hooks/useIsMobile';
import Menu from './Menu';
import { rankBoard, moveToRank } from '../utils/boardRanking';
import useBoardRankings from '../hooks/useBoardRankings';

const { BOARDS, BOARD_LABELS } = scoutingState;

const TAG_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'like', label: '✓ Like' },
    { id: 'avoid', label: '✗ Avoid' },
    { id: 'monitor', label: '? Monitor' },
    { id: 'untagged', label: 'Untagged' },
];

// Uses the same board-grid CenterBoard renders for Draft — building a
// personal big board is structurally the same problem as building the
// consensus one. Every player is clickable/undimmed here regardless of
// live-draft .drafted status (alwaysClickable/hideDraftedStyle on
// CenterBoard/PlayerCard) — scouting happens independent of who's already
// off the board in the real draft.
//
// Scouting BUILDS boards, it doesn't compare one personal opinion against a
// fixed consensus — so evaluations are kept per board (Consensus/Dan/Ryan,
// same three identities the Draft/UDFA board-switcher uses), all loaded at
// once here so the info card's ‹/› arrows can page between an analyst's
// takes on the same player without losing the current selection. "My
// Board" (ScoutingLeftPanel) always reflects the currently active board's
// in-progress personal order.
export default function ScoutingView({ players, columnOrder }) {
    const [boards, setBoards] = useState(() => Object.fromEntries(BOARDS.map(b => [b, scoutingState.loadState(b)])));
    const [activeBoard, setActiveBoard] = useState('consensus');
    // Each analyst's own rankings file — switching board switches the actual
    // player pool, not just the overlay on top of one shared list.
    const { pools } = useBoardRankings(players);
    const boardPlayers = pools?.[activeBoard] ?? players;
    const [selectedName, setSelectedName] = useState(null);
    const [tagFilter, setTagFilter] = useState('all');
    // On mobile the three columns stack, so the info card would sit far below
    // the board — tapping a player looked like it did nothing. Present it as
    // a modal there instead. Still fully editable: this is Scouting.
    const isMobile = useIsMobile();

    const state = boards[activeBoard];
    const entryIndex = useMemo(() => buildNameIndex(state.entries), [state.entries]);

    const entryFor = (name) => {
        const idx = findMatchingIndex(name, entryIndex);
        return idx !== -1 ? state.entries[idx] : null;
    };

    // Scouting's "Total Rank", "Position Rank" and "Round.Group" are not a
    // parallel set of fields — they ARE the board's own parameters, the ones
    // CenterBoard places cards by and the exported rankings CSV carries into
    // the draft board and roster import.
    //
    // Only the group and the within-tier order are stored. Total rank and
    // position rank are DERIVED from them (see boardRanking.js): subgroups
    // are authoritative, so 1.2 always outranks 1.3, and within a tier the
    // order is the analyst's explicit choice or, failing that, positional
    // value. That's why they can't drift apart or collide — there is one
    // ordering and both numbers are read off it.
    const effectivePlayers = useMemo(
        () => rankBoard(boardPlayers, entryFor),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [boardPlayers, entryIndex],
    );

    const visiblePlayers = useMemo(() => {
        if (tagFilter === 'all') return effectivePlayers;
        return effectivePlayers.filter(p => {
            const entry = entryFor(p.name);
            if (tagFilter === 'untagged') return !entry?.tag;
            return entry?.tag === tagFilter;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectivePlayers, tagFilter, entryIndex]);

    // Already ordered by effective rank above.
    const orderedPlayers = effectivePlayers;

    const selectedPlayer = selectedName ? effectivePlayers.find(p => p.name === selectedName) : null;

    // Records an explicit ordering by stamping each player's position WITHIN
    // ITS OWN TIER, plus the tier it now belongs to. Nothing stores a global
    // rank: that stays derived, so it can't drift out of step with the groups.
    // `groupOverrides` optionally moves specific players into another tier.
    const applyOrder = (entries, orderedNames, groupOverrides = {}) => {
        const out = [...entries];
        const now = new Date().toISOString();
        const groupOf = new Map(effectivePlayers.map(p => [p.name, p.group]));
        const seenPerGroup = new Map();

        orderedNames.forEach(name => {
            const group = groupOverrides[name] ?? groupOf.get(name) ?? null;
            const nextWithin = (seenPerGroup.get(group) ?? 0) + 1;
            seenPerGroup.set(group, nextWithin);

            const idx = findMatchingIndex(name, buildNameIndex(out));
            if (idx !== -1) {
                out[idx] = { ...out[idx], group, withinGroup: nextWithin, updatedAt: now };
            } else {
                const position = boardPlayers.find(p => p.name === name)?.position ?? '';
                out.push({ ...scoutingState.makeEntry(name, position), group, withinGroup: nextWithin, updatedAt: now });
            }
        });
        return out;
    };

    // History is per board — undoing on Dan's board must not rewind Ryan's.
    // Bounded, since a scouting board's entries can run to the full pool.
    const past = useRef({});
    // Depth is tracked per board, not as one number: the Undo button reflects
    // whichever board is on screen, and switching to an untouched board must
    // show nothing to undo rather than the previous board's depth.
    const [undoDepths, setUndoDepths] = useState({});
    const canUndo = (undoDepths[activeBoard] ?? 0) > 0;

    const recordDepth = (board) => {
        setUndoDepths(prev => ({ ...prev, [board]: past.current[board]?.length ?? 0 }));
    };

    const commitBoard = (entries) => {
        const next = { version: 1, entries };
        const stack = past.current[activeBoard] ?? (past.current[activeBoard] = []);
        stack.push(boards[activeBoard]);
        if (stack.length > 25) stack.shift();
        recordDepth(activeBoard);

        scoutingState.saveState(activeBoard, next);
        setBoards(prev => ({ ...prev, [activeBoard]: next }));
    };

    const undoBoard = () => {
        const stack = past.current[activeBoard];
        const previous = stack?.pop();
        if (!previous) return;
        recordDepth(activeBoard);
        scoutingState.saveState(activeBoard, previous);
        setBoards(prev => ({ ...prev, [activeBoard]: previous }));
    };

    const saveEntry = (updated) => {
        const current = effectivePlayers.find(p => p.name === updated.name);
        const wantedRank = updated.personalRank;
        const wantedGroup = updated.group;

        const boardState = boards[activeBoard];
        let entries = [...boardState.entries];
        const idx = findMatchingIndex(updated.name, buildNameIndex(entries));
        // personalRank is derived, never stored — strip it before persisting
        // so a stale copy can't start competing with the derivation.
        const { personalRank: _drop, ...persisted } = updated;
        if (idx !== -1) entries[idx] = { ...entries[idx], ...persisted };
        else entries.push(persisted);

        // Typing a total rank is a MOVE, not an assignment: the player takes
        // that slot, adopts that slot's tier, and everyone between the old and
        // new position shifts by one. Two players can never share a rank
        // because the rank is only ever read off the resulting order.
        if (wantedRank != null && current && wantedRank !== current.overallRank) {
            const moved = moveToRank(effectivePlayers, updated.name, wantedRank);
            if (moved) entries = applyOrder(entries, moved.order, { [updated.name]: moved.group });
        } else if (wantedGroup != null && current && wantedGroup !== current.group) {
            // Changing the tier directly: keep the rest of the order as-is and
            // let the derivation re-place this player within its new tier.
            entries = applyOrder(entries, effectivePlayers.map(p => p.name), { [updated.name]: wantedGroup });
        }

        commitBoard(entries);
    };

    // Drag-and-drop reorder from ScoutingLeftPanel. Dropping a player among a
    // different tier's players moves them into that tier, same as typing the
    // rank would.
    const handleReorder = (newOrderedNames) => {
        const idx = newOrderedNames.findIndex((n, i) => effectivePlayers[i]?.name !== n);
        const overrides = {};
        if (idx !== -1) {
            const movedName = newOrderedNames[idx];
            const neighbour = newOrderedNames[idx + 1] ?? newOrderedNames[idx - 1];
            const group = effectivePlayers.find(p => p.name === neighbour)?.group;
            if (group != null) overrides[movedName] = group;
        }
        commitBoard(applyOrder(boards[activeBoard].entries, newOrderedNames, overrides));
    };

    const cycleBoard = (dir) => {
        const idx = BOARDS.indexOf(activeBoard);
        setActiveBoard(BOARDS[(idx + dir + BOARDS.length) % BOARDS.length]);
    };

    const handleExport = () => {
        const csv = scoutingState.exportCSV(state);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scouting_${activeBoard}.csv`;
        a.click();
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const imported = scoutingState.parseCSV(text);
        scoutingState.saveState(activeBoard, imported);
        past.current[activeBoard] = []; recordDepth(activeBoard); // importing replaces the board
        setBoards(prev => ({ ...prev, [activeBoard]: imported }));
    };

    // group,name,position — ready to drop into public/ or load via
    // ?rankings=, unlike Export CSV above (which round-trips the full
    // overlay: tags/notes/matrix numbers/etc. for re-import into Scouting).
    const handleExportRankings = () => {
        const csv = scoutingState.exportRankingsCSV(effectivePlayers);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rankings_${activeBoard}_scouting.csv`;
        a.click();
    };

    return (
        <div className="roster-view">
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">SCOUTING</span>
                    <span className="roster-brand-sub">BUILD YOUR BOARD</span>
                </div>

                <div style={{ width: '20px' }} />

                <div className="board-switcher">
                    <span className="switcher-label">BOARD</span>
                    <div className="switcher-buttons">
                        {BOARDS.map(b => (
                            <button
                                key={b}
                                className={`switcher-btn ${activeBoard === b ? 'active' : ''}`}
                                onClick={() => setActiveBoard(b)}
                            >{BOARD_LABELS[b]}</button>
                        ))}
                    </div>
                </div>

                <div className="roster-zoom-ctrl" style={{ gap: 6 }}>
                    {TAG_FILTERS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setTagFilter(f.id)}
                            className={`rv-ctrl-btn ${tagFilter === f.id ? 'active' : ''}`}
                            style={{ width: 'auto', padding: '2px 8px' }}
                        >{f.label}</button>
                    ))}
                </div>

                <div style={{ flex: 1 }} />

                <div className="top-actions">
                    <button
                        onClick={undoBoard}
                        disabled={!canUndo}
                        className="action-pill undo-pill"
                        title="Undo the last change on this board"
                    >Undo</button>
                    <Menu items={[
                        { label: 'Export as Board CSV…', onClick: handleExportRankings, title: 'group,name,position — ready for public/ or ?rankings=' },
                        { label: 'Export Scouting CSV…', onClick: handleExport, title: 'Full overlay: tags, notes, matrix numbers' },
                        { label: 'Import Scouting CSV…', file: { accept: '.csv', onFile: handleImport } },
                    ]} />
                </div>
            </div>

            <div className="scouting-layout">
                <ScoutingLeftPanel
                    orderedPlayers={orderedPlayers}
                    selectedName={selectedName}
                    onSelect={(p) => setSelectedName(p.name)}
                    onReorder={handleReorder}
                />

                <CenterBoard
                    players={visiblePlayers}
                    onAction={(p) => setSelectedName(p.name)}
                    columnOrder={columnOrder}
                    isFocusMode={true}
                    alwaysClickable={true}
                    hideDraftedStyle={true}
                />

                {!isMobile && (
                    <ScoutingControls
                        key={`${selectedName || 'none'}-${activeBoard}`}
                        player={selectedPlayer}
                        entry={selectedPlayer ? entryFor(selectedPlayer.name) : null}
                        onChange={saveEntry}
                        onClose={() => setSelectedName(null)}
                        boardLabel={selectedPlayer ? BOARD_LABELS[activeBoard] : null}
                        onPrevBoard={() => cycleBoard(-1)}
                        onNextBoard={() => cycleBoard(1)}
                    />
                )}
            </div>

            {isMobile && selectedPlayer && (
                <ScoutingControls
                    key={`${selectedName}-${activeBoard}-modal`}
                    variant="modal"
                    player={selectedPlayer}
                    entry={entryFor(selectedPlayer.name)}
                    onChange={saveEntry}
                    onClose={() => setSelectedName(null)}
                    boardLabel={BOARD_LABELS[activeBoard]}
                    onPrevBoard={() => cycleBoard(-1)}
                    onNextBoard={() => cycleBoard(1)}
                />
            )}
        </div>
    );
}
