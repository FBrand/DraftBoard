import React, { useState } from 'react';
import PlayerCard from './PlayerCard';

const LeftPanel = ({ players, onDraft, onInfoOpen, tagFor }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const remaining = players
        .filter(p => !p.drafted)
        .filter(p => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return p.name.toLowerCase().includes(term) || p.position.toLowerCase().includes(term);
        })
        // Unranked sorts LAST, not first. An unranked player has no rank at
        // all — rankBoard returns null rather than the worst number, because
        // numbering him last would assert a judgement nobody made — and
        // `null - 5` is -5, which puts him above the best prospect in the
        // class, in the list an analyst scans on air. Same rule, same
        // expression, as boardEntries.readEntries.
        .sort((a, b) => (a.overallRank ?? Number.MAX_SAFE_INTEGER) - (b.overallRank ?? Number.MAX_SAFE_INTEGER));

    const rounds = [1, 2, 3, 4, 5, 6, 7, 8];

    return (
        <div className="side-panel left-panel">
            <h3 className="panel-title text-center">Remaining</h3>

            <div className="search-bar">
                {/* A placeholder is not a label: it vanishes as soon as
                    anybody types, and a screen reader announces an edit box
                    with no name at all. */}
                <input
                    type="text"
                    aria-label="Search players by name or position"
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
                                    <PlayerCard player={player} onInfoOpen={onInfoOpen} tag={tagFor?.(player.name, player)} />
                                </div>
                            ))
                        ) : (
                            <div className="no-results">No players matching "{searchTerm}"</div>
                        )}
                    </div>
                ) : (
                    // Grouped by round view
                    rounds.map(round => {
                        // const roundPlayers = remaining.filter(p => getRound(p.overallRank) === round);
                        const roundPlayers = remaining.filter(p => p.round === round);
                        if (roundPlayers.length === 0) return null;

                        return (
                            <div key={round} style={{ marginBottom: '1.5rem' }}>
                                <div className="round-header">
                                    <span>ROUND {round}</span>
                                </div>
                                <div className="rankings-list">
                                    {roundPlayers.map(player => (
                                        <div key={player.name} onClick={() => onDraft(player)} style={{ cursor: 'pointer' }}>
                                            <PlayerCard player={player} onInfoOpen={onInfoOpen} tag={tagFor?.(player.name, player)} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default LeftPanel;
