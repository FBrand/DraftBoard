import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards, listBoards } from '../../src/utils/boardRegistry';
import { openRegistry, clearRegistry, byId } from '../../src/utils/playerRegistry';
import { openEvaluations, ownerIdFor, remarksFor } from '../../src/utils/evaluations';
import * as scoutingState from '../../src/utils/scoutingState';
import { importBoardCSV } from '../../src/utils/boardImport';

const FILE = `round,tier,name,position,school,tag,evaluation
1,1,Fernando Mendoza,QB,Indiana,+,"Remarks:
+ Elite arm talent
- Footwork under pressure"
1,1,David Bailey,EDGE,Texas Tech,,
2,1,Somebody Brandnew,WR,Directional State,,"Remarks:
• Late riser"
`;

let board;

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate?.();
    await openBoards();
    await openRegistry();
    await openEvaluations();
    clearRegistry();
    board = listBoards()[0];
});

describe('importing a board from a spreadsheet', () => {
    it('places every row and reports what it did', () => {
        const summary = importBoardCSV(board, FILE);
        expect(summary.placed).toBe(3);
        expect(summary.remarks).toBe(3);
    });

    it('creates players the app has never seen, as ordinary players', () => {
        importBoardCSV(board, FILE);
        const entry = scoutingState.loadState(board.id).entries
            .find(e => e.name === 'Somebody Brandnew');

        expect(entry).toBeTruthy();
        expect(entry.playerId).toBeTruthy();
        expect(byId(entry.playerId)).toMatchObject({ position: 'WR', school: 'Directional State' });
    });

    it('keeps the order inside a tier, since that order is what was typed', () => {
        importBoardCSV(board, FILE);
        const tier = scoutingState.loadState(board.id).entries
            .filter(e => e.round === 1 && e.tier === 1)
            .sort((a, b) => a.withinGroup - b.withinGroup);

        expect(tier.map(e => e.name)).toEqual(['Fernando Mendoza', 'David Bailey']);
    });

    it('files remarks under the author, split by kind', () => {
        importBoardCSV(board, FILE);
        const ownerId = ownerIdFor(board);
        const entry = scoutingState.loadState(board.id).entries
            .find(e => e.name === 'Fernando Mendoza');

        const marks = remarksFor(ownerId, entry.playerId);
        expect(marks.map(r => r.kind).sort()).toEqual(['strength', 'weakness']);
        expect(marks.find(r => r.kind === 'strength').text).toBe('Elite arm talent');
    });

    it('does not duplicate remarks when the same file is imported twice', () => {
        importBoardCSV(board, FILE);
        const second = importBoardCSV(board, FILE);

        expect(second.remarks).toBe(0);
        const ownerId = ownerIdFor(board);
        const entry = scoutingState.loadState(board.id).entries
            .find(e => e.name === 'Fernando Mendoza');
        expect(remarksFor(ownerId, entry.playerId)).toHaveLength(2);
    });

    it('replaces the ranking rather than merging two orderings', () => {
        importBoardCSV(board, FILE);
        importBoardCSV(board, 'round,tier,name,position\n1,1,David Bailey,EDGE');

        const entries = scoutingState.loadState(board.id).entries;
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe('David Bailey');
    });

    it('marks the board seeded so the rankings file cannot overwrite the import', () => {
        importBoardCSV(board, FILE);
        expect(scoutingState.loadState(board.id).seeded).toBe(true);
    });
});
