import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';

/**
 * Drag-and-drop for the board grid, kept out of CenterBoard so the grid stays
 * a plain renderer when nothing is being edited.
 *
 * The drop target is the ROW, not the cell. Rows are tiers, columns are
 * positions — so dropping into another column would say a player has changed
 * position, which is a fact about him and not a judgement about where he
 * belongs. Only the tier is the analyst's to move.
 */

/** One draggable card. Wraps rather than replaces, so PlayerCard is untouched. */
export function DraggableCard({ id, data, disabled, children }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled });
    if (disabled) return children;
    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className={`board-draggable ${isDragging ? 'dragging-source' : ''}`}
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
