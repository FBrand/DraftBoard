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

    return (
        <div className="side-panel right-panel">
            <h3 className="panel-title">Picks</h3>
            <div className="panel-content scroll-container" ref={scrollRef}>
                <div className="tracker-list">
                    {remotePicks.length > 0 ? (
                        remotePicks.map(renderPickCard)
                    ) : (
                        <div className="empty-state">No feed data available. Enable Live Sync.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RightPanel;
