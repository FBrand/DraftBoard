import React, { useState, useMemo } from 'react';
import CenterBoard from './CenterBoard';
import ScoutingControls from './ScoutingControls';
import ScoutingLeftPanel from './ScoutingLeftPanel';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';
import useIsMobile from '../hooks/useIsMobile';

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

    const visiblePlayers = useMemo(() => {
        if (tagFilter === 'all') return players;
        return players.filter(p => {
            const entry = entryFor(p.name);
            if (tagFilter === 'untagged') return !entry?.tag;
            return entry?.tag === tagFilter;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [players, tagFilter, entryIndex]);

    // This board's in-progress order: personalRank when set, else fall back
    // to consensus overallRank so untouched players still sort sensibly
    // (a starting point to refine, not a comparison being drawn).
    const orderedPlayers = useMemo(() => {
        return [...players].sort((a, b) => {
            const ra = entryFor(a.name)?.personalRank ?? a.overallRank ?? Infinity;
            const rb = entryFor(b.name)?.personalRank ?? b.overallRank ?? Infinity;
            return ra - rb;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [players, entryIndex]);

    const selectedPlayer = selectedName ? players.find(p => p.name === selectedName) : null;

    const saveEntry = (updated) => {
        setBoards(prev => {
            const boardState = prev[activeBoard];
            const idx = findMatchingIndex(updated.name, buildNameIndex(boardState.entries));
            const entries = idx !== -1
                ? boardState.entries.map((e, i) => i === idx ? updated : e)
                : [...boardState.entries, updated];
            const next = { version: 1, entries };
            scoutingState.saveState(activeBoard, next);
            return { ...prev, [activeBoard]: next };
        });
    };

    // Drag-and-drop reorder from ScoutingLeftPanel: renumber personalRank
    // 1..N to match the new order, creating an entry for any player that
    // didn't have one yet (a plain drag with no prior tag/notes).
    const handleReorder = (newOrderedNames) => {
        setBoards(prev => {
            const boardState = prev[activeBoard];
            const entries = [...boardState.entries];
            newOrderedNames.forEach((name, i) => {
                const idx = findMatchingIndex(name, buildNameIndex(entries));
                if (idx !== -1) {
                    entries[idx] = { ...entries[idx], personalRank: i + 1, updatedAt: new Date().toISOString() };
                } else {
                    const position = players.find(p => p.name === name)?.position ?? '';
                    entries.push({ ...scoutingState.makeEntry(name, position), personalRank: i + 1, updatedAt: new Date().toISOString() });
                }
            });
            const next = { version: 1, entries };
            scoutingState.saveState(activeBoard, next);
            return { ...prev, [activeBoard]: next };
        });
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
        setBoards(prev => ({ ...prev, [activeBoard]: imported }));
    };

    // group,name,position — ready to drop into public/ or load via
    // ?rankings=, unlike Export CSV above (which round-trips the full
    // overlay: tags/notes/matrix numbers/etc. for re-import into Scouting).
    const handleExportRankings = () => {
        const csv = scoutingState.exportRankingsCSV(state);
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
                    <button onClick={handleExportRankings} className="action-pill" title="group,name,position — ready for public/ or ?rankings=">Export as Board CSV</button>
                    <button onClick={handleExport} className="action-pill">Export CSV</button>
                    <label className="action-pill" style={{ cursor: 'pointer' }}>
                        Import CSV
                        <input type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            <div className="scouting-layout">
                <ScoutingLeftPanel
                    orderedPlayers={orderedPlayers}
                    entryFor={entryFor}
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
