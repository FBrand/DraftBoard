import { describe, it, expect, beforeEach, vi } from 'vitest';
import { entryDocId, entriesPath, BOARD_ENTRIES } from '../../src/data/boardEntries';
import { makeEntry, loadState, saveState } from '../../src/utils/scoutingState';
import { openBoards, allBoards, boardById } from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';
import { entryFields, boardFields } from '../../src/data/fieldNames';
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

        const docs = repository.all(entriesPath(board()));
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

    it('keeps two boards apart by their path, not by their key', () => {
        // The board used to be half of every document id. It is the path now,
        // so the same player on two boards is the same id in two different
        // collections — which is what "this board's entries" means, and what a
        // rule about one board can be written against.
        const e = makeEntry('Fernando Mendoza', 'QB', 'Indiana', 'p_mendoza');
        expect(entryDocId('b1', e)).toBe(entryDocId('b2', e));
        expect(entriesPath('b1')).not.toBe(entriesPath('b2'));
        expect(entriesPath('b1')).toBe('boards/b1/entries');
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
    // writeEntries goes through commitMany, not commit: the entries and the
    // board's own "entries changed at" stamp have to land together or the
    // stamp is not trustworthy — see the note in data/boardEntries.js. So the
    // items are flat {collection, id, doc}, and the entry writes are the ones
    // filed under the entries path.
    const entryWrites = (spy, id) => spy.mock.calls
        .flatMap(([items]) => items)
        .filter(i => i.collection === entriesPath(id));
    const boardWrites = (spy) => spy.mock.calls
        .flatMap(([items]) => items)
        .filter(i => i.collection === 'boards');

    it('writes one document when one player moves', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });

        // From the board as it was LOADED, which is what every caller in the
        // app has. Rebuilding entries from scratch would re-stamp updatedAt on
        // all of them and there would be nothing for the diff to skip.
        const loaded = loadState(id).entries;
        const spy = vi.spyOn(repository, 'commitMany');
        const moved = loaded.map(e => (e.name === 'Arvell Reese' ? { ...e, round: 1, tier: 2 } : e));
        saveState(id, { version: 1, entries: moved });

        const changes = entryWrites(spy, id);
        expect(changes).toHaveLength(1);
        // Identified by the document key, since the name is the registry's now.
        expect(changes[0].id).toContain('p_reese');
        // Stored under the short field name — see data/fieldNames.js.
        expect(entryFields.fat(changes[0].doc).round).toBe(1);
        spy.mockRestore();
    });

    it('stamps the board in the SAME write, so the two cannot disagree', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });

        const loaded = loadState(id).entries;
        const spy = vi.spyOn(repository, 'commitMany');
        const moved = loaded.map(e => (e.name === 'Arvell Reese' ? { ...e, round: 3 } : e));
        saveState(id, { version: 1, entries: moved });

        // One call, carrying both — not two calls that could land apart.
        expect(spy).toHaveBeenCalledTimes(1);
        const stamped = boardWrites(spy);
        expect(stamped).toHaveLength(1);
        expect(stamped[0].id).toBe(id);
        expect(stamped[0].doc.u).toEqual(expect.any(Number));
        // And the board it stamped keeps its identity: a whole-document write
        // built from a stale cache is how authorship would get lost.
        expect(stamped[0].doc.a).toBe(repository.get('boards', id).a);
        spy.mockRestore();
    });

    it('writes nothing at all when nothing changed — including no stamp', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });

        const loaded = loadState(id).entries;
        const spy = vi.spyOn(repository, 'commitMany');
        saveState(id, { version: 1, entries: loaded });

        // The stamp must not move on an idle save, or every other device
        // re-reads 328 documents for nothing.
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('removes a player dropped from the board', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });
        saveState(id, { version: 1, entries: three().slice(0, 2) });

        expect(loadState(id).entries.map(e => e.name).sort()).toEqual(['Arvell Reese', 'Fernando Mendoza']);
        expect(repository.all(entriesPath(board()))).toHaveLength(2);
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

        // Read through the board's own field map: the store writes short
        // names, and asserting the long one would pass only by accident.
        expect(boardFields.fat(repository.get('boards', id)).seeded).toBe(true);
        expect(boardById(id).seeded).toBe(true);
        expect(repository.all(entriesPath(board())).every(d => d.seeded === undefined)).toBe(true);
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
        const ryansDocs = ryansView
            .filter(e => e.name === 'Caleb Downs')
            .map(e => ({ id: entryDocId(id, e), doc: { position: e.position, round: e.round, tier: e.tier } }));
        await repository.commit(entriesPath(id), ryansDocs);

        const after = loadState(id);
        expect(after.entries.find(e => e.name === 'Fernando Mendoza').round, 'Dan\'s move was erased').toBe(1);
        expect(after.entries.find(e => e.name === 'Caleb Downs').round).toBe(3);
    });
});

/**
 * The 329-write bug: opening a board whose entries had not been read
 * rewrote every one of its placements from the rankings file.
 *
 * Entries load per board now, so "no entries in memory" stopped meaning
 * "this board has none" and started also meaning "nobody has read it yet".
 * loadState returned no `seeded` field in that case, which reads as false,
 * which told seedBoard to materialise the board from scratch — 328 entry
 * writes plus the board's own stamp. On a board owned by somebody else
 * every one is refused, and that is what the queue filled with.
 */
describe('a seeded board whose entries have not been read', () => {
    it('still reports itself as seeded, so nothing re-materialises it', () => {
        const id = board();
        saveState(id, { version: 1, entries: three() });
        expect(loadState(id).seeded).toBe(true);

        // Drop the entries from memory WITHOUT unseeding the board — exactly
        // the state a board is in when another board was the one loaded.
        repository.invalidate(entriesPath(id));
        const state = loadState(id);
        expect(state.entries).toHaveLength(0);
        expect(state.seeded).toBe(true);
    });

    it('a board that genuinely never was seeded still reports false', () => {
        // The one case that SHOULD seed must not be broken by the fix.
        const fresh = allBoards().find(b => b.id !== board());
        if (!fresh) return;
        repository.invalidate(entriesPath(fresh.id));
        expect(loadState(fresh.id).seeded).toBe(boardById(fresh.id)?.seeded ?? false);
    });
});
