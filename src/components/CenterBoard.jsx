import React from 'react';
import PlayerCard from './PlayerCard';

// Generalized board-grid primitive: position columns x round/tier rows,
// derived purely from `players`' own position/group/drafted fields. Reused
// across Draft (onAction = draft the player), UDFA (onAction = sign them),
// and Scouting (onAction = open tag/rank/notes controls) — see
// /home/dev/.claude/plans/structured-growing-cat.md.
const CenterBoard = ({ players, onAction, columnOrder = [], isFocusMode = false, alwaysClickable = false, hideDraftedStyle = false, onInfoOpen, tagFor }) => {
    const visiblePlayers = isFocusMode ? players : players.filter(p => !p.drafted);

    const rawPositions = [...new Set(players.map(p => p.position.split('.', 1)[0]))];

    // Sort positions: defined order first, then any extras found in data
    const positions = [
        ...columnOrder.filter(cp => rawPositions.includes(cp)),
        ...rawPositions.filter(rp => !columnOrder.includes(rp))
    ];

    // Subgroup row order comes from the group labels themselves ("1.1", "1.2",
    // "2.1", …), sorted by round then tier. This used to be first-appearance
    // order in `players`, which silently depended on the caller handing over
    // players in rankings-CSV order — Scouting sorts by rank instead, which
    // scrambled the rows. Sorting the labels is what was actually meant by
    // "rows never swap positions", and is stable for every caller.
    const groupKey = (group) => {
        const m = String(group ?? '').match(/^(\d+)(?:\.(\d+))?/);
        if (!m) return [Number.MAX_SAFE_INTEGER, 0];
        return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0];
    };
    const masterGroups = [...new Set(players.map(p => p.group))].sort((a, b) => {
        const [ra, ta] = groupKey(a);
        const [rb, tb] = groupKey(b);
        return ra - rb || ta - tb || String(a).localeCompare(String(b));
    });

    // Strip out active groups natively while inheriting the stable order
    const activeGroupsSet = new Set(visiblePlayers.map(p => p.group));
    const allGroups = masterGroups.filter(g => activeGroupsSet.has(g));

    // A player with no group is UNRANKED — nobody has placed him in a tier.
    // He gets his own row after every round rather than falling into round 1,
    // which is where an unlabelled group used to land.
    const UNRANKED_ROUND = 99;
    const getRoundFromGroup = (group) => {
        if (group == null || group === '') return UNRANKED_ROUND;
        const match = group.toString().match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : UNRANKED_ROUND;
    };

    // Group our rows (groups) into rounds for the sidebar labels
    const roundConfig = [];
    let currentRow = 2; // Row 1 is header
    [1, 2, 3, 4, 5, 6, 7, 8, UNRANKED_ROUND].forEach(r => {
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
                {positions.map((pos) => (
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
                        {rc.round === UNRANKED_ROUND ? 'UR' : rc.round < 8 ? rc.round : ''}
                    </div>
                ))}

                {/* Group Rows */}
                {allGroups.map((group, groupIdx) => {
                    const isLastInRound = groupIdx === allGroups.length - 1 ||
                        getRoundFromGroup(allGroups[groupIdx + 1]) !== getRoundFromGroup(group);

                    return (
                        <div key={String(group)} className={`board-row ${isLastInRound ? 'round-row-end' : 'subgroup-row-end'}`}>
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
                                                    onClick={onAction}
                                                    slim={true}
                                                    alwaysClickable={alwaysClickable}
                                                    hideDraftedStyle={hideDraftedStyle}
                                                    onInfoOpen={onInfoOpen}
                                                    tag={tagFor?.(player.name, player)}
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
