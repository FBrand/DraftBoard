import React, { useState, useMemo } from 'react';
import CenterBoard from './CenterBoard';
import ScoutingControls from './ScoutingControls';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';

const TAG_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'like', label: '✓ Like' },
    { id: 'avoid', label: '✗ Avoid' },
    { id: 'monitor', label: '? Monitor' },
    { id: 'untagged', label: 'Untagged' },
];

// Uses the same board-grid CenterBoard renders for Draft — building a
// personal big board is structurally the same problem as building the
// consensus one. Read-only board (v1): click a card to open tag/rank/notes
// controls rather than dragging cards to reorder tiers — see plan doc for
// why that's scoped out of this first pass.
export default function ScoutingView({ players, columnOrder }) {
    const [state, setState] = useState(() => scoutingState.loadState());
    const [selectedName, setSelectedName] = useState(null);
    const [tagFilter, setTagFilter] = useState('all');

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

    const selectedPlayer = selectedName ? players.find(p => p.name === selectedName) : null;

    const saveEntry = (updated) => {
        setState(prev => {
            const idx = findMatchingIndex(updated.name, buildNameIndex(prev.entries));
            const entries = idx !== -1
                ? prev.entries.map((e, i) => i === idx ? updated : e)
                : [...prev.entries, updated];
            const next = { version: 1, entries };
            scoutingState.saveState(next);
            return next;
        });
    };

    const handleExport = () => {
        const csv = scoutingState.exportCSV(state);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scouting_overlay.csv';
        a.click();
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const imported = scoutingState.parseCSV(text);
        scoutingState.saveState(imported);
        setState(imported);
    };

    return (
        <div className="roster-view">
            <div className="top-panel">
                <div className="roster-brand">
                    <span className="roster-brand-name">SCOUTING</span>
                    <span className="roster-brand-sub">BUILD YOUR BOARD</span>
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
                    <button onClick={handleExport} className="action-pill">Export CSV</button>
                    <label className="action-pill" style={{ cursor: 'pointer' }}>
                        Import CSV
                        <input type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            <CenterBoard
                players={visiblePlayers}
                onAction={(p) => setSelectedName(p.name)}
                columnOrder={columnOrder}
                isFocusMode={true}
            />

            {selectedPlayer && (
                <ScoutingControls
                    key={selectedPlayer.name}
                    player={selectedPlayer}
                    entry={entryFor(selectedPlayer.name)}
                    onChange={saveEntry}
                    onClose={() => setSelectedName(null)}
                />
            )}
        </div>
    );
}
