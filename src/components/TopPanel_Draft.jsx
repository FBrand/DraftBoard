import React, { useState, useCallback } from 'react';
import { exportBoardToImage } from '../utils/exportBoard';
import Toast from './Toast';

const TopPanel = ({ currentPick, currentPickStatus, ourPicksLeft, onUndo, onUpdatePicks, onReset, isLiveSync, canLiveSync, toggleLiveSync, isFocusMode, onToggleFocus }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [toast, setToast] = useState(null);
    const dismissToast = useCallback(() => setToast(null), []);

    // finally, not a plain sequence: a throwing export used to leave the
    // button stuck in its "exporting" state permanently.
    const handleExport = async () => {
        setIsExporting(true);
        try {
            await exportBoardToImage();
        } catch (err) {
            setToast({ message: err.message, tone: 'error' });
        } finally {
            setIsExporting(false);
        }
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
        return (
            <div className="top-panel top-panel--focus">
                <div className="pick-section">
                    <div className="pick-info">
                        <span className="pick-label">{currentPickStatus || 'NOW DRAFTING'}</span>
                        <span className="pick-number">#{currentPick}</span>
                    </div>
                    <div className="pick-info">
                        {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
                    </div>
                </div>
                <div style={{ width: '10px' }} />
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
                <div className="board-switcher">
                    <span className="switcher-label">BOARD</span>
                    <div className="switcher-buttons">
                        <button
                            className={`switcher-btn ${!currentRankings || currentRankings.includes('rankings_consensus.csv') ? 'active' : ''}`}
                            onClick={() => updateRankingsParam(`${import.meta.env.BASE_URL}rankings_consensus.csv`)}
                        >
                            Consensus
                        </button>
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
                    </div>
                </div>
                <div className="top-actions">
                    <button className="action-pill trade-pill" onClick={onUpdatePicks}>Update Picks</button>
                    <button
                        className="action-pill export-pill"
                        onClick={handleExport}
                        disabled={isExporting}
                    >
                        {isExporting ? 'Generating...' : 'Export Board'}
                    </button>
                    <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Exit Full Board</button>
                    <button className="action-pill undo-pill" onClick={onUndo}>Undo</button>
                </div>

                <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
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
                <button className="action-pill focus-pill" onClick={onToggleFocus}>⛶ Full Board</button>
                <button className="action-pill reset-pill" onClick={onReset}>Reset All</button>
            </div>

            <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
        </div>
    );
};

export default TopPanel;
