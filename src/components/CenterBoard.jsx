import React from 'react';
import PlayerCard from './PlayerCard';

const CenterBoard = ({ players, onDraft, columnOrder = [] }) => {
    const rawPositions = [...new Set(players.map(p => p.position))];

    // Sort positions: defined order first, then any extras found in data
    const positions = [
        ...columnOrder.filter(cp => rawPositions.includes(cp)),
        ...rawPositions.filter(rp => !columnOrder.includes(rp))
    ];

    // Extract all unique groups in the order they appear
    const allGroups = [];
    players.forEach(p => {
        if (!allGroups.includes(p.group)) {
            allGroups.push(p.group);
        }
    });

    const getRoundFromGroup = (group) => {
        if (!group) return 1;
        const match = group.toString().match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 1;
    };

    // Group our rows (groups) into rounds for the sidebar labels
    const roundConfig = [];
    let currentRow = 2; // Row 1 is header
    [1, 2, 3, 4, 5, 6, 7].forEach(r => {
        const groupsInRound = allGroups.filter(g => getRoundFromGroup(g) === r);
        if (groupsInRound.length > 0) {
            roundConfig.push({
                round: r,
                start: currentRow,
                span: groupsInRound.length
            });
            currentRow += groupsInRound.length;
        }
    });

    // For each position, find the best available player
    const bestAvailable = {};
    positions.forEach(pos => {
        bestAvailable[pos] = players.find(p => p.position === pos && !p.drafted);
    });

    return (
        <div className="center-board-container" style={{ '--pos-count': positions.length }}>
            <div className="board-grid">
                {/* Header Row */}
                <div className="header-cell round-header-label">RD</div>
                {positions.map(pos => (
                    <div key={pos} className="header-cell">
                        <h3>{pos}</h3>
                    </div>
                ))}

                {/* Round Sidebar Labels (Sticky Left + Span Rows) */}
                {roundConfig.map(rc => (
                    <div
                        key={rc.round}
                        className={`round-sidebar-label round-${rc.round}`}
                        style={{
                            gridRow: `${rc.start} / span ${rc.span}`,
                            gridColumn: 1
                        }}
                    >
                        {rc.round}
                    </div>
                ))}

                {/* Group Rows */}
                {allGroups.map((group, groupIdx) => {
                    const isLastInRound = groupIdx === allGroups.length - 1 ||
                        getRoundFromGroup(allGroups[groupIdx + 1]) !== getRoundFromGroup(group);

                    return (
                        <div key={group} className={`board-row ${isLastInRound ? 'round-row-end' : 'subgroup-row-end'}`}>
                            {positions.map(pos => {
                                const roundPlayers = players.filter(p => p.position === pos && p.group === group);

                                return (
                                    <div key={pos} className="slot-cell">
                                        {roundPlayers.map(player => {
                                            const isBest = bestAvailable[pos]?.name === player.name;
                                            return (
                                                <PlayerCard
                                                    key={`${player.name}-${player.position}`}
                                                    player={player}
                                                    isBest={isBest}
                                                    onClick={onDraft}
                                                    slim={true}
                                                />
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CenterBoard;
