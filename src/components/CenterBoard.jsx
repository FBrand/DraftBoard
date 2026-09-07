import React from 'react';
import PlayerCard from './PlayerCard';
import { tierKey, compareTiers } from '../utils/boardRanking';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { DraggableCard, DroppableCell } from './BoardDnd';

// Generalized board-grid primitive: position columns x round/tier rows,
// derived purely from `players`' own position/group/drafted fields. Reused
// across Draft (onAction = draft the player), UDFA (onAction = sign them),
// and Scouting (onAction = open tag/rank/notes controls) — see
// /home/dev/.claude/plans/structured-growing-cat.md.
/**
 * `editable` turns the grid into something an analyst can rearrange: cards
 * become draggable and tier rows become drop targets, and `onPlace(player,
 * tier)` is called with the row a card was dropped on.
 *
 * Off by default. During a live draft the board must not move under a
 * mis-click, and a card there is a thing you press to draft somebody.
 */
const CenterBoard = ({ players, onAction, columnOrder = [], isFocusMode = false, alwaysClickable = false, hideDraftedStyle = false, onInfoOpen, tagFor, editable = false, onPlace, takenTest, showTaken = false }) => {
    // What counts as GONE depends on the board you are looking at.
    //
    // The draft board asks "was he drafted", and a player who went undrafted
    // was not — even once somebody signs him, which sets the same flag. So on
    // that board a UDFA is still available, because in draft terms he is.
    // The UDFA board asks "is he still unsigned", where that same signing does
    // take him off the list. One predicate, supplied by the caller.
    const isTaken = takenTest ?? ((pl) => !!pl.drafted);
    const [dragging, setDragging] = React.useState(null);
    const sensors = useSensors(
        // Same activation as the roster grid: 8px of movement, so a click to
        // open a card is never mistaken for the start of a drag.
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    );

    const handleDragEnd = ({ active, over }) => {
        setDragging(null);
        if (!over || !onPlace) return;
        const player = active.data.current?.player;
        const target = over.data.current;
        if (!player || !target?.tier) return;

        // Dropped ON a card: he goes above that man, adopting his tier and
        // column. Dropped on the cell itself: tier and column only.
        const before = target.player && target.player.name !== player.name ? target.player : null;

        const samePlace = player.round === target.tier.round && player.tier === target.tier.tier;
        const samePosition = !target.position
            || player.position.split('.', 1)[0] === target.position;
        if (samePlace && samePosition && !before) return;

        onPlace(player, { ...target.tier, position: target.position, before });
    };
    // Normal view collapses a TIER once everybody in it is gone. It does not
    // remove players one at a time.
    //
    // It used to do exactly that — filter(!drafted) — and the difference shows
    // up the moment a position thins out: Delane and Downs share tier 1.2, so
    // taking Delane emptied the round-1 CB cell while the row itself stayed
    // for Downs. What you saw was a blank column, which reads as "nobody
    // ranked a corner" rather than "the corner went sixth". A drafted player
    // is still information — he is where he was, struck through, and the run
    // on a position is visible because his card is still sitting in it.
    // The draft board keeps a drafted player in place — the run on a position
    // is the information. The UDFA board is a list of who is LEFT to sign, and
    // leaving the signed ones in it buried eleven available players under a
    // hundred and forty-two who were already gone.
    const visiblePlayers = (showTaken || isFocusMode) ? players : players.filter(p => !isTaken(p));

    // Whether a ROW still earns its place: in normal view, only while somebody
    // in it is undrafted.
    const liveTiers = new Set(
        (isFocusMode ? players : players.filter(p => !isTaken(p)))
            .map(p => tierKey(p.round, p.tier)),
    );

    const rawPositions = [...new Set(players.map(p => p.position.split('.', 1)[0]))];

    // Sort positions: defined order first, then any extras found in data
    const positions = [
        ...columnOrder.filter(cp => rawPositions.includes(cp)),
        ...rawPositions.filter(rp => !columnOrder.includes(rp))
    ];

    // Row order comes from the tiers themselves, sorted by round then tier.
    // This used to be first-appearance order in `players`, which silently
    // depended on the caller handing players over in rankings-CSV order —
    // Scouting sorts by rank instead, which scrambled the rows. Sorting the
    // tiers is what was actually meant by "rows never swap positions", and is
    // stable for every caller.
    const tiers = new Map();
    players.forEach(p => {
        const key = tierKey(p.round, p.tier);
        if (!tiers.has(key)) tiers.set(key, { key, round: p.round, tier: p.tier });
    });
    const masterGroups = [...tiers.values()].sort(compareTiers);

    // Only rows that still have someone left to take.
    const allGroups = masterGroups.filter(g => liveTiers.has(g.key));

    // A player with no round is UNRANKED — nobody has placed him in a tier.
    // He gets his own row after every round rather than falling into round 1.
    const UNRANKED_ROUND = 99;
    const getRoundFromGroup = (g) => g?.round ?? UNRANKED_ROUND;

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
        bestAvailable[pos] = players.find(p => p.position.split('.', 1)[0] === pos && !isTaken(p));
    });

    const grid = (
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
                        <div key={group.key} className={`board-row ${isLastInRound ? 'round-row-end' : 'subgroup-row-end'}`}>
                            {positions.map(pos => {
                                const roundPlayers = visiblePlayers.filter(p => p.position.split('.', 1)[0] === pos && tierKey(p.round, p.tier) === group.key);

                                return (
                                    <DroppableCell
                                        key={pos}
                                        id={`cell-${group.key}-${pos}`}
                                        // Both axes: a cell is a tier AND a
                                        // position, and dropping into another
                                        // column is how you correct a player
                                        // somebody filed under the wrong one.
                                        data={{ tier: { round: group.round, tier: group.tier }, position: pos }}
                                        disabled={!editable}
                                        className="slot-cell"
                                    >
                                        {roundPlayers.map(player => {
                                            const isBest = bestAvailable[pos]?.name === player.name;
                                            // Not taken by THIS board's rule
                                            // renders as plainly available —
                                            // undimmed, no pick label, and
                                            // clickable.
                                            const shown = isTaken(player) ? player : { ...player, drafted: false };
                                            const card = (
                                                <PlayerCard
                                                    player={shown}
                                                    isBest={isBest}
                                                    onClick={onAction}
                                                    slim={true}
                                                    alwaysClickable={alwaysClickable}
                                                    hideDraftedStyle={hideDraftedStyle}
                                                    onInfoOpen={onInfoOpen}
                                                    tag={tagFor?.(player.name, player)}
                                                />
                                            );
                                            return (
                                                <DraggableCard
                                                    key={`${player.name}-${player.position}`}
                                                    id={`card-${player.name}-${player.position}`}
                                                    data={{
                                                        player,
                                                        tier: { round: group.round, tier: group.tier },
                                                        position: pos,
                                                    }}
                                                    disabled={!editable}
                                                >{card}</DraggableCard>
                                            );
                                        })}
                                    </DroppableCell>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // No DndContext unless the board is editable: it installs document-level
    // listeners and an auto-scroller, which a board nobody is rearranging has
    // no use for.
    if (!editable) return grid;

    return (
        <DndContext
            sensors={sensors}
            onDragStart={({ active }) => setDragging(active.data.current?.player ?? null)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDragging(null)}
        >
            {grid}
            <DragOverlay dropAnimation={null}>
                {dragging && (
                    <div className="board-drag-overlay">
                        <PlayerCard player={dragging} slim alwaysClickable hideDraftedStyle />
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
};

export default React.memo(CenterBoard);
