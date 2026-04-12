import React, { useEffect, useRef } from 'react';
import PlayerCard from './PlayerCard';
import { serializeDraftState, deserializeDraftState, getExportFilename } from '../utils/sessionSerializer';

const RightPanel = ({ remotePicks, draftedPlayers, currentPick, ourPicksLeft, onImport }) => {
    const scrollRef = useRef(null);
    const currentPickRef = useRef(null);
    const fileInputRef = useRef(null);

    // Auto-scroll to current pick
    useEffect(() => {
        if (currentPickRef.current) {
            currentPickRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [currentPick, remotePicks.length]);

    const handleExport = () => {
        const csv = serializeDraftState(draftedPlayers, ourPicksLeft);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getExportFilename();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            try {
                const importedState = deserializeDraftState(text);
                if (importedState.draftedPlayers.length > 0 || importedState.ourPicksLeft.length > 0) {
                    onImport(importedState);
                } else {
                    alert("No valid draft data found in file.");
                }
            } catch (err) {
                console.error("Parse error:", err);
                alert("Failed to parse draft file. Please ensure it's a valid CSV.");
            }
        };
        reader.readAsText(file);
        // Reset input
        e.target.value = '';
    };

    const renderPickCard = (p) => {
        const isCurrent = p.overall === currentPick;
        const player = p.player || draftedPlayers.find(dp => dp.pickNumber === p.overall) || {
            name: "",
            position: "",
            overallRank: "",
            drafted: false
        };

        return (
            <div key={p.overall} ref={isCurrent ? currentPickRef : null}>
                <PlayerCard
                    player={player}
                    team={p.team}
                    displayPick={p.overall}
                    isBest={false}
                    noStrikethrough={true}
                    isCurrent={isCurrent}
                />
            </div>
        );
    };

    const displayPicks = remotePicks.length > 0 ? remotePicks : Array.from({ length: 259 }, (_, i) => {
        const overall = i + 1;
        const player = draftedPlayers.find(dp => dp.pickNumber === overall);
        return {
            overall,
            team: player?.draftedByUs ? "KC" : "-",
            player
        };
    });

    return (
        <div className="side-panel right-panel">
            <h3 className="panel-title">Picks</h3>
            <div className="panel-content scroll-container" ref={scrollRef}>
                <div className="tracker-list">
                    {displayPicks.map(renderPickCard)}
                </div>
            </div>

            <div className="panel-actions">
                <button className="action-button secondary" onClick={handleExport}>
                    Save Session
                </button>
                <button className="action-button primary" onClick={handleImportClick}>
                    Load Session
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".csv"
                    onChange={handleFileChange}
                />
            </div>
        </div>
    );
};

export default RightPanel;
