import React, { useState } from 'react';
import ScoutingControls from './ScoutingControls';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';

const { BOARDS, BOARD_LABELS } = scoutingState;

// Read-only player info card, opened by right-click / long-press on a player
// anywhere OUTSIDE Scouting — the draft board, UDFA, and the Roster/FA depth
// charts. Scouting is where evaluations get written; everywhere else this is
// a reference card you glance at mid-draft, so it never edits (an accidental
// long-press on air shouldn't be able to change a ranking).
//
// `player` may be a full player object (Draft/UDFA cards) or just
// `{ name, position }` (roster slots hold names, not player records) — only
// those two fields are read.
export default function PlayerInfoModal({ player, onClose }) {
    const [activeBoard, setActiveBoard] = useState('consensus');
    const [boards] = useState(() => Object.fromEntries(BOARDS.map(b => [b, scoutingState.loadState(b)])));

    if (!player) return null;

    const state = boards[activeBoard];
    const idx = findMatchingIndex(player.name, buildNameIndex(state.entries));
    const entry = idx !== -1 ? state.entries[idx] : null;

    const cycleBoard = (dir) => {
        const i = BOARDS.indexOf(activeBoard);
        setActiveBoard(BOARDS[(i + dir + BOARDS.length) % BOARDS.length]);
    };

    return (
        <ScoutingControls
            key={activeBoard}
            variant="modal"
            readOnly
            player={player}
            entry={entry}
            onClose={onClose}
            boardLabel={BOARD_LABELS[activeBoard]}
            onPrevBoard={() => cycleBoard(-1)}
            onNextBoard={() => cycleBoard(1)}
        />
    );
}
