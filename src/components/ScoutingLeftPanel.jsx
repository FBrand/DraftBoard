import React, { useState, useCallback } from 'react';
import {
    DndContext, DragOverlay, useDraggable, useDroppable,
    useSensor, useSensors, MouseSensor, TouchSensor,
} from '@dnd-kit/core';
import PlayerCard from './PlayerCard';

// One draggable+droppable row. Draggable via the handle only (keeps the
// click-to-select target free of drag-listener interference) — same split
// DepthChartGrid.jsx uses for its position-row reordering.
function Row({ player, rank, group, onSelect, isSelected }) {
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
        id: `sc-drag-${player.name}`,
        data: { name: player.name },
    });
    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: `sc-drop-${player.name}`,
        data: { name: player.name },
    });

    return (
        <div
            ref={node => { setDragRef(node); setDropRef(node); }}
            className={`scouting-rank-row ${isDragging ? 'dragging-source' : ''} ${isOver ? 'drag-over' : ''} ${isSelected ? 'selected' : ''}`}
        >
            <div className="scouting-rank-handle" {...listeners} {...attributes} style={{ cursor: 'grab' }}>⠿</div>
            <div className="scouting-rank-num">{rank}</div>
            {group && <div className="scouting-rank-group">{group}</div>}
            <div className="scouting-rank-card" onClick={() => onSelect(player)}>
                <PlayerCard player={player} alwaysClickable hideDraftedStyle noStrikethrough />
            </div>
        </div>
    );
}

// Global personal-ranking list — the Scouting-side analogue of Draft's
// LeftPanel, except it's not just "remaining undrafted players" (this is a
// personal big board, drafted-or-not doesn't matter) and it's editable via
// drag-and-drop rather than click-to-draft. Dragging a row to a new spot
// reorders the whole list and the caller renumbers personalRank 1..N to
// match — see ScoutingView.jsx's handleReorder.
export default function ScoutingLeftPanel({ orderedPlayers, entryFor, selectedName, onSelect, onReorder }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeName, setActiveName] = useState(null);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    );

    const visible = searchTerm
        ? orderedPlayers.filter(p => {
            const term = searchTerm.toLowerCase();
            return p.name.toLowerCase().includes(term) || p.position.toLowerCase().includes(term);
        })
        : orderedPlayers;

    const handleDragStart = useCallback(({ active }) => {
        setActiveName(active.data.current?.name ?? null);
    }, []);

    const handleDragEnd = useCallback(({ active, over }) => {
        setActiveName(null);
        if (!over) return;
        const fromName = active.data.current?.name;
        const toName = over.data.current?.name;
        if (!fromName || !toName || fromName === toName) return;

        const names = orderedPlayers.map(p => p.name);
        const fromIdx = names.indexOf(fromName);
        const toIdx = names.indexOf(toName);
        if (fromIdx === -1 || toIdx === -1) return;

        const next = [...names];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        onReorder(next);
    }, [orderedPlayers, onReorder]);

    const activePlayer = activeName ? orderedPlayers.find(p => p.name === activeName) : null;

    return (
        <div className="side-panel left-panel">
            <h3 className="panel-title text-center">My Board</h3>

            <div className="search-bar">
                <input
                    type="text"
                    placeholder="Search name or position..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />
            </div>

            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveName(null)}>
                <div className="panel-content scroll-container">
                    {visible.length > 0 ? (
                        <div className="scouting-rank-list">
                            {visible.map((player, i) => (
                                <Row
                                    key={player.name}
                                    player={player}
                                    rank={searchTerm ? (orderedPlayers.indexOf(player) + 1) : (i + 1)}
                                    group={entryFor?.(player.name)?.group}
                                    onSelect={onSelect}
                                    isSelected={player.name === selectedName}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="no-results">No players matching "{searchTerm}"</div>
                    )}
                </div>

                <DragOverlay dropAnimation={null}>
                    {activePlayer ? (
                        <div className="scouting-rank-row rv-drag-overlay">
                            <div className="scouting-rank-card"><PlayerCard player={activePlayer} noStrikethrough /></div>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    );
}
