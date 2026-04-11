import React, { useState } from 'react';
import PlayerCard from './PlayerCard';

const LeftPanel = ({ players, onDraft }) => {
    const [expandedRounds, setExpandedRounds] = useState({ 1: true });
    const remaining = players.filter(p => !p.drafted).sort((a, b) => a.overallRank - b.overallRank);

    const getRound = (rank) => Math.min(7, Math.ceil(rank / 32));

    const rounds = [1, 2, 3, 4, 5, 6, 7];

    const toggleRound = (round) => {
        setExpandedRounds(prev => ({ ...prev, [round]: !prev[round] }));
    };

    return (
        <div className="side-panel">
            <h3 className="panel-title">Remaining Players (By Round)</h3>
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {rounds.map(round => {
                    const roundPlayers = remaining.filter(p => getRound(p.overallRank) === round);
                    if (roundPlayers.length === 0) return null;

                    return (
                        <div key={round} style={{ marginBottom: '1.5rem' }}>
                            <div
                                className="round-header"
                                onClick={() => toggleRound(round)}
                            >
                                <span>ROUND {round}</span>
                                <span>{expandedRounds[round] ? '−' : '+'}</span>
                            </div>
                            {expandedRounds[round] && roundPlayers.map(player => (
                                <PlayerCard key={player.name} player={player} onClick={onDraft} />
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LeftPanel;
