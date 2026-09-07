import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';

/**
 * Drag-and-drop for the board grid, kept out of CenterBoard so the grid stays
 * a plain renderer when nothing is being edited.
 *
 * Two kinds of drop target, because there are two kinds of move.
 *
 * A CELL is a tier and a position: dropping on empty space in one says "he
 * belongs in this tier, in this column". A CARD is a place in the order:
 * dropping on one says "he goes here, above this man". Without the second,
 * a board could only ever be re-tiered — you could move a player to round 2
 * and never say he is the best of the round 2 quarterbacks.
 */

/** One draggable card. Wraps rather than replaces, so PlayerCard is untouched. */
export function DraggableCard({ id, data, disabled, children }) {
    const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id, data, disabled });
    // The same node also accepts a drop: landing on a card is how you say
    // where in the order somebody goes, not just which tier.
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop-${id}`, data, disabled });
    if (disabled) return children;
    return (
        <div
            ref={node => { setDragRef(node); setDropRef(node); }}
            {...listeners}
            {...attributes}
            className={`board-draggable ${isDragging ? 'dragging-source' : ''} ${isOver ? 'board-card-over' : ''}`}
        >
            {children}
        </div>
    );
}

/**
 * A cell that will accept a card, carrying its ROW's tier.
 *
 * The cell rather than the row, because `.board-row` is `display: contents` —
 * it has no box, so a droppable on it measures an empty rect and can never be
 * "over" anything. The cell is the real grid item.
 *
 * It still only reports the tier. Dropping into another column must not move a
 * player to another position: that is a fact about him, not a judgement about
 * where he belongs.
 */
export function DroppableCell({ id, data, disabled, className, children }) {
    const { setNodeRef, isOver } = useDroppable({ id, data, disabled });
    if (disabled) return <div className={className}>{children}</div>;
    return (
        <div ref={setNodeRef} className={`${className} ${isOver ? 'board-cell-over' : ''}`}>
            {children}
        </div>
    );
}
