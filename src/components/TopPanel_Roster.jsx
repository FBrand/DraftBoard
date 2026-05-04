import React, { useState } from 'react';
import { exportBoardToImage } from '../utils/exportBoard';

const TopPanel = ({ currentPick, currentPickStatus, ourPicksLeft, onUndo, onUpdatePicks, onReset, isLiveSync, canLiveSync, toggleLiveSync, isFocusMode, onToggleFocus }) => {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        await exportBoardToImage();
        setIsExporting(false);
    };

    const updateRankingsParam = (newPath) => {
        const params = new URLSearchParams(window.location.search);
        params.set('rankings', newPath);
        window.location.href = `?${params.toString()}`;
    };

    const currentRankings = new URLSearchParams(window.location.search).get('rankings') || '';

    const picksList = [...ourPicksLeft].filter(p => p >= currentPick).sort((a, b) => a - b);

    // ── Focus Mode ────────────────────────────────────────────────────────────
    if (isFocusMode) {
        const boardName = currentRankings.includes('rankings_chris.csv') ? 'Chris'
            : currentRankings.includes('rankings_dan.csv') ? 'Dan'
                : currentRankings.includes('rankings_ryan.csv') ? 'Ryan'
                    : currentRankings.includes('rankings_seth.csv') ? 'Seth'
                        : 'Consensus';

        return (
            //<div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '2px solid rgba(255,183,0,0.2)', background: 'rgba(255,255,255,0.02)' }}>
            <div className="top-panel">
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#FFD700', letterSpacing: '0.05em' }}>ROSTER</h2>
                <div style={{ flex: 1, textAlign: 'right', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-dim)', display: 'flex', justifyContent: 'flex-end', gap: 24, paddingRight: 16 }}>
                    <span>Total: <strong style={{ color: 'var(--text-main)' }}>{total}</strong> / 90</span>
                    <span>Practice Squad: <strong style={{ color: 'var(--text-main)' }}>{psCount}</strong> / 16+1</span>
                    <span>Roster: <strong style={{ color: 'var(--text-main)' }}>{destined53}</strong> / 53</span>
                </div>
                <button onClick={handleImport} style={btnStyle}>⬆ Import CSV</button>
                <button onClick={handleExport} style={btnStyle}>⬇ Export CSV</button>
                <button onClick={() => {
                    fetch('/roster.csv')
                        .then(r => r.ok ? r.text() : Promise.reject(r.status))
                        .then(text => setState(parseCSV(text)))
                        .catch(() => setState(defaultState()));
                }} style={{ ...btnStyle, color: 'rgba(255,100,100,0.8)' }}>↺ Reset</button>
            </div>

        );
    }

    // ── Normal Mode ───────────────────────────────────────────────────────────
    return (
        <div className="top-panel">
            <div className="pick-section">
                <div className="pick-info">
                    <span className="pick-label">{currentPickStatus || 'NOW DRAFTING'}</span>
                    <span className="pick-number">#{currentPick}</span>
                </div>
                {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
            </div>
            <div style={{ width: '5px' }} />

            <div className="our-picks-tracker">
                <span className="tracker-label">OUR PICKS LEFT</span>
                <div className="picks-list">
                    {picksList.map(p => (
                        <span key={p} className={`pick-pill ${p === currentPick ? 'active' : ''}`}>
                            #{p}
                        </span>
                    ))}
                </div>
            </div>

            <div className="top-actions">
                <div className="board-switcher">
                    <span className="switcher-label">BOARD</span>
                    <div className="switcher-buttons">
                        <button
                            className={`switcher-btn ${!currentRankings || currentRankings.includes('rankings_consensus.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_consensus.csv`)}
                        >
                            Consensus
                        </button>
                        {/* <button
                            className={`switcher-btn ${currentRankings.includes('rankings_chris.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_chris.csv`)}
                        >
                            Chris
                        </button> */}
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_dan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_dan.csv`)}
                        >
                            Dan
                        </button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_ryan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_ryan.csv`)}
                        >
                            Ryan
                        </button>
                        {/* <button
                            className={`switcher-btn ${currentRankings.includes('rankings_seth.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_seth.csv`)}
                        >
                            Seth
                        </button> */}
                    </div>
                </div>
                {canLiveSync && (
                    <label className="sync-toggle">
                        <input
                            type="checkbox"
                            checked={isLiveSync}
                            onChange={toggleLiveSync}
                        />
                        Live Sync
                    </label>
                )}
                <button className="action-pill undo-pill" onClick={onUndo}>Undo</button>
                <button className="action-pill trade-pill" onClick={onUpdatePicks}>Update Picks</button>
                <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Focus</button>
                <button className="action-pill reset-pill" onClick={onReset}>Reset All</button>
            </div>
        </div>
    );
};

export default TopPanel;
