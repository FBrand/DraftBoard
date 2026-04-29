import React from 'react';
import PlayerCard from './PlayerCard';

const CenterBoard = ({ players, onDraft, columnOrder = [], isFocusMode = false }) => {
    const visiblePlayers = isFocusMode ? players : players.filter(p => !p.drafted);

    const rawPositions = [...new Set(players.map(p => p.position.split('.', 1)[0]))];

    // Sort positions: defined order first, then any extras found in data
    const positions = [
        ...columnOrder.filter(cp => rawPositions.includes(cp)),
        ...rawPositions.filter(rp => !columnOrder.includes(rp))
    ];

    // Extract absolute group order from the unmodified players set to ensure rows never swap positions
    const masterGroups = [];
    players.forEach(p => {
        if (!masterGroups.includes(p.group)) {
            masterGroups.push(p.group);
        }
    });

    // Strip out active groups natively while inheriting the stable order
    const activeGroupsSet = new Set(visiblePlayers.map(p => p.group));
    const allGroups = masterGroups.filter(g => activeGroupsSet.has(g));

    const getRoundFromGroup = (group) => {
        if (!group) return 1;
        const match = group.toString().match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 1;
    };

    // Group our rows (groups) into rounds for the sidebar labels
    const roundConfig = [];
    let currentRow = 2; // Row 1 is header
    [1, 2, 3, 4, 5, 6, 7, 8].forEach(r => {
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
        bestAvailable[pos] = players.find(p => p.position.split('.', 1)[0] === pos && !p.drafted);
    });

    return (
        <div className="center-board-container" style={{ '--pos-count': positions.length }}>
            <div className="board-grid">
                {/* Header Row */}
                <div 
                    className="header-cell round-header-label" 
                    style={{ position: 'sticky', top: 0, left: 0, zIndex: 100 }}
                >
                    RD
                </div>
                {positions.map((pos, idx) => (
                    <div 
                        key={pos} 
                        className="header-cell"
                        style={{ position: 'sticky', top: 0, zIndex: 90 }}
                    >
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
                            gridColumn: 1,
                            position: 'sticky',
                            left: 0,
                            zIndex: 80
                        }}
                    >
                        {rc.round < 8 ? rc.round : ''}
                    </div>
                ))}

                {/* Group Rows */}
                {allGroups.map((group, groupIdx) => {
                    const isLastInRound = groupIdx === allGroups.length - 1 ||
                        getRoundFromGroup(allGroups[groupIdx + 1]) !== getRoundFromGroup(group);

                    return (
                        <div key={group} className={`board-row ${isLastInRound ? 'round-row-end' : 'subgroup-row-end'}`}>
                            {positions.map(pos => {
                                const roundPlayers = visiblePlayers.filter(p => p.position.split('.', 1)[0] === pos && p.group === group);

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

export default React.memo(CenterBoard);
