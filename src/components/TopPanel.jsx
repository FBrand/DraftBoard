import React, { useState } from 'react';
import { exportBoardToImage } from '../utils/exportBoard';

const TopPanel = ({ currentPick, ourPicksLeft, onUndo, onUpdatePicks, onReset, isLiveSync, canLiveSync, toggleLiveSync, isFocusMode, onToggleFocus }) => {
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
            <div className="top-panel top-panel--focus">
                <div className="pick-info">
                    <span className="pick-label">NOW DRAFTING</span>
                    <span className="pick-number">#{currentPick}</span>
                    {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
                </div>
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
                <div className="focus-board-name">BOARD: {boardName}</div>
                <div className="top-actions">
                    <button className="action-pill undo-pill" onClick={onUndo}>Undo</button>
                    <button className="action-pill trade-pill" onClick={onUpdatePicks}>Update Picks</button>
                    <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Exit Focus</button>
                </div>
            </div>
        );
    }

    // ── Normal Mode ───────────────────────────────────────────────────────────
    return (
        <div className="top-panel">
            <div className="pick-info">
                <span className="pick-label">NOW DRAFTING</span>
                <span className="pick-number">#{currentPick}</span>
                {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
            </div>

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
                            className={`switcher-btn ${!currentRankings || currentRankings.includes('rankings.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam('/DraftBoard/rankings.csv')}
                        >
                            Consensus
                        </button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_chris.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam('/DraftBoard/rankings_chris.csv')}
                        >
                            Chris
                        </button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_dan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam('/DraftBoard/rankings_dan.csv')}
                        >
                            Dan
                        </button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_ryan.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam('/DraftBoard/rankings_ryan.csv')}
                        >
                            Ryan
                        </button>
                        <button
                            className={`switcher-btn ${currentRankings.includes('rankings_seth.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam('/DraftBoard/rankings_seth.csv')}
                        >
                            Seth
                        </button>
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
                <button
                    className="action-pill export-pill"
                    onClick={handleExport}
                    disabled={isExporting}
                >
                    {isExporting ? 'Generating...' : 'Export Board'}
                </button>
                <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Focus</button>
                <button className="action-pill reset-pill" onClick={onReset}>Reset All</button>
            </div>
        </div>
    );
};

export default TopPanel;
