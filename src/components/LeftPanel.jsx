import React, { useState } from 'react';
import PlayerCard from './PlayerCard';

const LeftPanel = ({ players, onDraft, onDraftUnranked }) => {
    const [expandedRounds, setExpandedRounds] = useState({ 1: true });
    const [searchTerm, setSearchTerm] = useState('');

    const getRound = (rank) => Math.min(7, Math.ceil(rank / 32));

    const remaining = players
        .filter(p => !p.drafted)
        .filter(p => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return p.name.toLowerCase().includes(term) || p.position.toLowerCase().includes(term);
        })
        .sort((a, b) => a.overallRank - b.overallRank);

    const rounds = [1, 2, 3, 4, 5, 6, 7];

    const toggleRound = (round) => {
        setExpandedRounds(prev => ({ ...prev, [round]: !prev[round] }));
    };

    return (
        <div className="side-panel left-panel">
            <h3 className="panel-title text-center">Remaining</h3>

            <div className="search-bar">
                <input
                    type="text"
                    placeholder="Search name or position..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />
            </div>

            <div className="panel-content scroll-container">
                {searchTerm ? (
                    // Flat list view for search results
                    <div className="rankings-list">
                        {remaining.length > 0 ? (
                            remaining.map(player => (
                                <div key={player.name} onClick={() => onDraft(player)} style={{ cursor: 'pointer' }}>
                                    <PlayerCard player={player} />
                                </div>
                            ))
                        ) : (
                            <div className="no-results">No players matching "{searchTerm}"</div>
                        )}
                    </div>
                ) : (
                    // Grouped by round view
                    rounds.map(round => {
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
                                {expandedRounds[round] && (
                                    <div className="rankings-list">
                                        {roundPlayers.map(player => (
                                            <div key={player.name} onClick={() => onDraft(player)} style={{ cursor: 'pointer' }}>
                                                <PlayerCard player={player} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            <div className="panel-actions">
                <button className="action-button primary w-full" onClick={onDraftUnranked}>
                    Draft Unranked Player
                </button>
            </div>
        </div>
    );
};

export default LeftPanel;
