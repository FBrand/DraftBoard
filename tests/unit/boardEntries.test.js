import { describe, it, expect, beforeEach, vi } from 'vitest';
import { entryDocId } from '../../src/data/boardEntries';
import { makeEntry, loadState, saveState } from '../../src/utils/scoutingState';
import { openBoards, allBoards } from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';
import { loadRegistry, PLAYERS } from '../../src/utils/playerRegistry';

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
/**
 * The players these entries point at have to exist.
 *
 * An entry no longer stores the player's name — the registry holds it, and a
 * copy beside the id is a second answer that a rename leaves behind. So a
 * board entry is now a reference, and a test that invents a playerId with no
 * record behind it is testing a dangling one. The app never has those: every
 * id comes from resolveAll, which mints the record.
 */
const CAST = [
    { id: 'p_mendoza', name: 'Fernando Mendoza', position: 'QB', school: 'Indiana' },
    { id: 'p_reese', name: 'Arvell Reese', position: 'EDGE', school: 'Ohio State' },
    { id: 'p_downs', name: 'Caleb Downs', position: 'S', school: 'Ohio State' },
    { id: 'p_love', name: 'Jeremiyah Love', position: 'RB', school: 'Notre Dame' },
];

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
    await repository.ready(PLAYERS);
    CAST.forEach(p => repository.set(PLAYERS, p.id, { ...p, aliases: [], hidden: false }));
    loadRegistry();
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
        // The name is NOT among them — it is the registry's. What comes back
        // out of loadState still has it; see the next test.
        expect(docs.every(d => d.name === undefined)).toBe(true);
        expect(loadState(board()).entries.map(e => e.name).sort())
            .toEqual(['Arvell Reese', 'Caleb Downs', 'Fernando Mendoza']);
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
        // Everybody is here, with the name the registry holds. Nobody has been
        // placed, so the order is the last tiebreak — the same one rankBoard
        // falls back to.
        expect(state.entries.map(e => e.name).sort())
            .toEqual(['Arvell Reese', 'Caleb Downs', 'Fernando Mendoza']);
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
        // Identified by the document key, since the name is the registry's now.
        expect(changes[0].id).toContain('p_reese');
        expect(changes[0].doc.round).toBe(1);
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

        expect(loadState(id).entries.map(e => e.name).sort()).toEqual(['Arvell Reese', 'Fernando Mendoza']);
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

    it('orders by where the board put people, not by the order they were saved', () => {
        // There is no stored `order`. It was a second ordering sitting next to
        // the tiers, free to disagree with them, and rankBoard never read it —
        // it sorts by tier, then withinGroup, then the source rank, then
        // positional value, then the name. Shuffling the array cannot change a
        // board, because the array is not where the board's opinion lives.
        const id = board();
        const [a, b, c] = three();
        saveState(id, {
            version: 1,
            entries: [
                { ...a, round: 2, tier: 1, withinGroup: 1 },
                { ...b, round: 1, tier: 1, withinGroup: 1 },
                { ...c, round: 1, tier: 1, withinGroup: 2 },
            ],
        });

        expect(loadState(id).entries.map(e => e.name))
            .toEqual(['Arvell Reese', 'Caleb Downs', 'Fernando Mendoza']);

        // Saved in a different array order, same board, same answer.
        const l = loadState(id).entries;
        saveState(id, { version: 1, entries: [l[2], l[0], l[1]] });
        expect(loadState(id).entries.map(e => e.name))
            .toEqual(['Arvell Reese', 'Caleb Downs', 'Fernando Mendoza']);
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
