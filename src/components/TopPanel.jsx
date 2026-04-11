import React, { useState } from 'react';
import { exportBoardToImage } from '../utils/exportBoard';

const TopPanel = ({ currentPick, ourPicksLeft, onUndo, onUpdatePicks, onReset, isLiveSync, canLiveSync, toggleLiveSync }) => {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        await exportBoardToImage();
        setIsExporting(false);
    };

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
