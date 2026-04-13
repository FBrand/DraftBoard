import React, { useState } from 'react';
import { exportBoardToImage } from '../utils/exportBoard';

const TopPanel = ({ currentPick, ourPicksLeft, onUndo, onUpdatePicks, onReset, isLiveSync, canLiveSync, toggleLiveSync }) => {
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

    return (
        <div className="top-panel">
            <div className="top-panel">
                <div className="pick-info">
                    <span className="pick-label">NOW DRAFTING</span>
                    <span className="pick-number">#{currentPick}</span>
                </div>
                <div className="top-panel">
                    {ourPicksLeft.includes(currentPick) && <span className="our-pick-badge">OURS</span>}
                </div>
            </div>

            <div className="board-switcher">
                <span className="switcher-label">BOARD</span>
                <div className="switcher-buttons">
                    <button
                        className={`switcher-btn ${!new URLSearchParams(window.location.search).get('rankings') || new URLSearchParams(window.location.search).get('rankings')?.includes('rankings.csv') ? 'active' : ''}`}
                        onClick={() => updateRankingsParam('/DraftBoard/rankings.csv')}
                    >
                        Consensus
                    </button>
                    <button
                        className={`switcher-btn ${new URLSearchParams(window.location.search).get('rankings')?.includes('rankings_dan.csv') ? 'active' : ''}`}
                        onClick={() => updateRankingsParam('/DraftBoard/rankings_dan.csv')}
                    >
                        Dan
                    </button>
                    <button
                        className={`switcher-btn ${new URLSearchParams(window.location.search).get('rankings')?.includes('rankings_ryan.csv') ? 'active' : ''}`}
                        onClick={() => updateRankingsParam('/DraftBoard/rankings_ryan.csv')}
                    >
                        Ryan
                    </button>
                </div>
            </div>

            <div className="our-picks-tracker">
                <span className="tracker-label">OUR PICKS LEFT</span>
                <div className="picks-list">
                    {[...ourPicksLeft].filter(p => p >= currentPick).sort((a, b) => a - b).map(p => (
                        <span key={p} className={`pick-pill ${p === currentPick ? 'active' : ''}`}>
                            #{p}
                        </span>
                    ))}
                </div>
            </div>

            <div className="top-actions">
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
                    {isExporting ? 'Generating...' : 'Export JPEG'}
                </button>
                <button className="action-pill reset-pill" onClick={onReset}>Reset All</button>
            </div>
        </div>
    );
};

export default TopPanel;
