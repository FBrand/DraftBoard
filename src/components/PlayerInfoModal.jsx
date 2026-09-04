import React, { useState } from 'react';
import ScoutingControls from './ScoutingControls';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';

const { BOARDS, BOARD_LABELS } = scoutingState;

// Cross-cutting info card: right-click / long-press on a player card outside
// Scouting opens this. Same per-board evaluation Scouting's own info card
// edits (see ScoutingView.jsx) — reached from wherever you spot a player
// worth a note, not only from the Scouting tab. Rendered by App.jsx keyed on
// the selected player's name, so it resets to the Consensus board each time
// a different player is opened.
export default function PlayerInfoModal({ player, onClose }) {
    const [activeBoard, setActiveBoard] = useState('consensus');
    const [boards, setBoards] = useState(() => Object.fromEntries(BOARDS.map(b => [b, scoutingState.loadState(b)])));

    if (!player) return null;

    const state = boards[activeBoard];
    const idx = findMatchingIndex(player.name, buildNameIndex(state.entries));
    const entry = idx !== -1 ? state.entries[idx] : null;

    const handleChange = (updated) => {
        setBoards(prev => {
            const boardState = prev[activeBoard];
            const i = findMatchingIndex(updated.name, buildNameIndex(boardState.entries));
            const entries = i !== -1
                ? boardState.entries.map((e, x) => x === i ? updated : e)
                : [...boardState.entries, updated];
            const next = { version: 1, entries };
            scoutingState.saveState(activeBoard, next);
            return { ...prev, [activeBoard]: next };
        });
    };

    const cycleBoard = (dir) => {
        const i = BOARDS.indexOf(activeBoard);
        setActiveBoard(BOARDS[(i + dir + BOARDS.length) % BOARDS.length]);
    };

    return (
        <ScoutingControls
            key={activeBoard}
            variant="modal"
            player={player}
            entry={entry}
            onChange={handleChange}
            onClose={onClose}
            boardLabel={BOARD_LABELS[activeBoard]}
            onPrevBoard={() => cycleBoard(-1)}
            onNextBoard={() => cycleBoard(1)}
        />
    );
}
