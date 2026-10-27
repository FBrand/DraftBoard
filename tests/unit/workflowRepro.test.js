import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards, createBoard, boardBySlug, listBoards, BOARDS_COLLECTION } from '../../src/utils/boardRegistry';
import { openRegistry, resolve as resolvePlayer } from '../../src/utils/playerRegistry';
import { saveState, loadState, makeEntry } from '../../src/utils/scoutingState';
import { resolveBoardPlayers } from '../../src/utils/boardPlayers';
import { entriesPath } from '../../src/data/boardEntries';

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
    await openRegistry();
});

describe('Scouting to Draft workflow', () => {
    it('updates boardPlayers when editing ranking without browser reload', async () => {
        // 1. Initial consensus players in useDraftState
        const consensusPlayers = [
            { name: 'Travis Hunter', position: 'CB', school: 'Colorado', round: 1, tier: 1, overallRank: 1 },
            { name: 'Cam Ward', position: 'QB', school: 'Miami', round: 1, tier: 2, overallRank: 2 },
            { name: 'Abdul Carter', position: 'EDGE', school: 'Penn State', round: 2, tier: 1, overallRank: 3 },
            { name: 'Fernando Mendoza', position: 'QB', school: 'Cal', round: 3, tier: 1, overallRank: 4 },
        ];

        // Ensure players are in registry
        consensusPlayers.forEach(p => resolvePlayer(p, { create: true }));

        // 2. User creates a new board
        const board = await createBoard({ label: 'Felix Board' });
        expect(board).toBeTruthy();
        expect(board.slug).toBe('felix-board');

        // Initial check: all unranked
        let boardPlayers = resolveBoardPlayers(consensusPlayers, board.slug);
        expect(boardPlayers.every(p => p.round === null)).toBe(true);

        // 3. User subscribes in App.jsx
        let epoch = 0;
        const unsub = repository.subscribe(entriesPath(board.id), () => {
            epoch += 1;
        });

        // 4. User ranks 3 players in Scouting
        const entries = [
            { ...makeEntry('Travis Hunter', 'CB', 'Colorado'), round: 1, tier: 1, withinGroup: 1 },
            { ...makeEntry('Cam Ward', 'QB', 'Miami'), round: 1, tier: 2, withinGroup: 1 },
            { ...makeEntry('Abdul Carter', 'EDGE', 'Penn State'), round: 2, tier: 1, withinGroup: 1 },
        ];
        saveState(board.id, { version: 1, entries });

        expect(epoch).toBeGreaterThan(0);

        // 5. Switching to Draft Board view
        boardPlayers = resolveBoardPlayers(consensusPlayers, board.slug);
        const hunter = boardPlayers.find(p => p.name === 'Travis Hunter');
        const ward = boardPlayers.find(p => p.name === 'Cam Ward');
        const carter = boardPlayers.find(p => p.name === 'Abdul Carter');
        const mendoza = boardPlayers.find(p => p.name === 'Fernando Mendoza');

        expect(hunter.round).toBe(1);
        expect(ward.round).toBe(1);
        expect(carter.round).toBe(2);
        expect(mendoza.round).toBeNull();

        // 6. User now EDITS the ranking in Scouting (e.g. moves Cam Ward to Round 1 Tier 1)
        const updatedEntries = [
            { ...makeEntry('Travis Hunter', 'CB', 'Colorado'), round: 1, tier: 1, withinGroup: 1 },
            { ...makeEntry('Cam Ward', 'QB', 'Miami'), round: 1, tier: 1, withinGroup: 2 },
            { ...makeEntry('Abdul Carter', 'EDGE', 'Penn State'), round: 2, tier: 1, withinGroup: 1 },
        ];
        saveState(board.id, { version: 1, entries: updatedEntries });

        // 7. Re-resolve boardPlayers
        boardPlayers = resolveBoardPlayers(consensusPlayers, board.slug);
        const updatedWard = boardPlayers.find(p => p.name === 'Cam Ward');
        expect(updatedWard.tier).toBe(1);

        unsub();
    });
});
