import { describe, it, expect, beforeEach, vi } from 'vitest';
import { entryDocId } from '../../src/data/boardEntries';
import { makeEntry, loadState, saveState } from '../../src/utils/scoutingState';
import { openBoards, allBoards } from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';

/**
 * One document per player per board.
 *
 * A board was a single JSON blob rewritten whole on every change. Fine for one
 * person, wrong for two: two analysts moving different players on the same
 * board are two whole-blob writes racing, and the later one wins with a copy
 * that never saw the earlier one.
 *
 * The point of the change is the DIFF. The app has no "move one player" call —
 * every caller hands over a whole board — so if saving wrote all of it, the
 * documents would be per-player in name only and the race would be exactly as
 * bad as before.
 */
beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
});

const board = () => allBoards()[0].id;
const three = () => [
    makeEntry('Fernando Mendoza', 'QB', 'Indiana', 'p_mendoza'),
    makeEntry('Arvell Reese', 'EDGE', 'Ohio State', 'p_reese'),
    makeEntry('Caleb Downs', 'S', 'Ohio State', 'p_downs'),
];

describe('what a board is stored as', () => {
    it('is one document per player, not one per board', () => {
        saveState(board(), { version: 1, entries: three() });

        const docs = repository.all('board_entries');
        expect(docs).toHaveLength(3);
        expect(docs.map(d => d.name).sort()).toEqual(['Arvell Reese', 'Caleb Downs', 'Fernando Mendoza']);
    });

    it('addresses a player by his registry id, which survives a name correction', () => {
        const id = entryDocId('b1', makeEntry('Fernando Mendoza', 'QB', 'Indiana', 'p_mendoza'));
        const afterTypoFix = entryDocId('b1', makeEntry('Fernándo Mendoza', 'QB', 'Indiana', 'p_mendoza'));
        expect(afterTypoFix).toBe(id);
    });

    it('falls back to the folded name and position when there is no id', () => {
        const a = entryDocId('b1', makeEntry('Fernando Mendoza', 'QB'));
        const b = entryDocId('b1', makeEntry('fernando  mendoza', 'QB'));
        expect(b).toBe(a);
    });

    it('keeps two boards apart even for the same player', () => {
        const e = makeEntry('Fernando Mendoza', 'QB', 'Indiana', 'p_mendoza');
        expect(entryDocId('b1', e)).not.toBe(entryDocId('b2', e));
    });

    it('comes back as the shape every caller already reads', () => {
        saveState(board(), { version: 1, entries: three() });
        const state = loadState(board());

        expect(state.version).toBe(1);
        expect(state.entries.map(e => e.name)).toEqual(['Fernando Mendoza', 'Arvell Reese', 'Caleb Downs']);
        // And nothing about where it is filed leaks into the entry.
        expect(state.entries[0].boardId).toBeUndefined();
        expect(state.entries[0].order).toBeUndefined();
    });
});

describe('saving a board writes only what moved', () => {
    const commitsFrom = (spy) => spy.mock.calls.map(([, changes]) => changes);

    it('writes one document when one player moves', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });

        // From the board as it was LOADED, which is what every caller in the
        // app has. Rebuilding entries from scratch would re-stamp updatedAt on
        // all of them and there would be nothing for the diff to skip.
        const loaded = loadState(id).entries;
        const spy = vi.spyOn(repository, 'commit');
        const moved = loaded.map(e => (e.name === 'Arvell Reese' ? { ...e, round: 1, tier: 2 } : e));
        saveState(id, { version: 1, entries: moved });

        const changes = commitsFrom(spy).flat();
        expect(changes).toHaveLength(1);
        expect(changes[0].doc.name).toBe('Arvell Reese');
        spy.mockRestore();
    });

    it('writes nothing at all when nothing changed', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });

        const loaded = loadState(id).entries;
        const spy = vi.spyOn(repository, 'commit');
        saveState(id, { version: 1, entries: loaded });

        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('removes a player dropped from the board', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });
        saveState(id, { version: 1, entries: three().slice(0, 2) });

        expect(loadState(id).entries.map(e => e.name)).toEqual(['Fernando Mendoza', 'Arvell Reese']);
        expect(repository.all('board_entries')).toHaveLength(2);
    });

    it('does not touch another analyst’s board', () => {
        const [a, b] = allBoards().map(x => x.id);
        saveState(a, { version: 1, entries: three() });
        saveState(b, { version: 1, entries: [makeEntry('Jeremiyah Love', 'RB', 'Notre Dame', 'p_love')] });

        const moved = loadState(a).entries.map(e => (e.name === 'Fernando Mendoza' ? { ...e, round: 2 } : e));
        saveState(a, { version: 1, entries: moved });

        expect(loadState(b).entries.map(e => e.name)).toEqual(['Jeremiyah Love']);
    });

    it('keeps the order the board was saved in', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });

        const l = loadState(id).entries;
        const reordered = [l[2], l[0], l[1]];
        saveState(id, { version: 1, entries: reordered });

        expect(loadState(id).entries.map(e => e.name))
            .toEqual(['Caleb Downs', 'Fernando Mendoza', 'Arvell Reese']);
    });
});

describe('the board-level seeded flag', () => {
    it('lives on the board, not repeated on every entry', () => {
        const id = board();
        saveState(id, { version: 1, seeded: true, entries: three() });

        expect(repository.get('boards', id).seeded).toBe(true);
        expect(repository.all('board_entries').every(d => d.seeded === undefined)).toBe(true);
    });
});

describe('two analysts editing one board', () => {
    it('do not overwrite each other when they move different players', async () => {
        // The whole reason for the change. Both start from the same board,
        // each moves one player, and both save — which is what two browsers
        // pointed at one board do.
        const id = board();
        saveState(id, { version: 1, entries: three() });

        const asBothSawIt = loadState(id).entries;
        const dansView = asBothSawIt.map(e => (e.name === 'Fernando Mendoza' ? { ...e, round: 1, tier: 1 } : e));
        const ryansView = asBothSawIt.map(e => (e.name === 'Caleb Downs' ? { ...e, round: 3, tier: 2 } : e));

        saveState(id, { version: 1, entries: dansView });
        // Ryan's save is built from the board as HE last saw it — without
        // Dan's move. As one blob it would erase it.
        const ryansDocs = ryansView.map(e => ({ id: entryDocId(id, e), doc: { id: entryDocId(id, e), boardId: id, ...e } }));
        await repository.commit('board_entries', ryansDocs.filter(c => c.doc.name === 'Caleb Downs'));

        const after = loadState(id);
        expect(after.entries.find(e => e.name === 'Fernando Mendoza').round, 'Dan\'s move was erased').toBe(1);
        expect(after.entries.find(e => e.name === 'Caleb Downs').round).toBe(3);
    });
});
