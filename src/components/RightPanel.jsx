import React, { useEffect, useRef } from 'react';
import PlayerCard from './PlayerCard';

const RightPanel = ({ remotePicks, draftedPlayers, currentPick }) => {
    const scrollRef = useRef(null);
    const currentPickRef = useRef(null);

    // Auto-scroll to current pick
    useEffect(() => {
        if (currentPickRef.current) {
            currentPickRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [currentPick, remotePicks.length]);

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
        </div>
    );
};

export default RightPanel;
