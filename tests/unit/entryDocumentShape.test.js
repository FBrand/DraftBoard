import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import { writeEntries, readEntries, entriesPath } from '../../src/data/boardEntries';
import { entryFields } from '../../src/data/fieldNames';

/**
 * A placement document carries a placement.
 *
 * `entryFields.lean()` passes a key it does not recognise straight through,
 * under its long name — and the app hands `writeEntries` whole player objects,
 * because `saveEntry` spreads the display shape over the stored one. So an
 * ordinary edit wrote `strengths`, `weaknesses` and `notes` onto a board entry:
 * empty arrays, spelled out in full, on the largest collection in the app.
 *
 * Remarks moved to `evaluations/{player}/remarks` so they would stop riding
 * along on boards, and short field names are most of why this collection fell
 * by 76%. Both are undone by one unrecognised key.
 */
const BOARD = 'b_test';

beforeEach(async () => {
    repository.invalidate();
    await repository.ready(entriesPath(BOARD));
    const existing = repository.docs(entriesPath(BOARD)) ?? {};
    const drop = Object.keys(existing).map(id => ({ id, doc: null }));
    if (drop.length) await repository.commit(entriesPath(BOARD), drop);
});

const storedDoc = (playerId) => repository.get(entriesPath(BOARD), playerId);

describe('what reaches the document', () => {
    it('keeps the declared fields', async () => {
        await writeEntries(BOARD, [{
            playerId: 'p_1', name: 'Arvell Reese', position: 'EDGE',
            round: 1, tier: 1, withinGroup: 4, tag: 'avoid', updatedAt: 1,
        }]);

        const doc = storedDoc('p_1');
        expect(doc).toMatchObject({ p: 'EDGE', r: 1, i: 1, w: 4, g: 'avoid' });
    });

    it('drops evaluation fields the display shape drags along', async () => {
        await writeEntries(BOARD, [{
            playerId: 'p_2', name: 'Somebody', position: 'CB', round: 2, tag: 'like',
            strengths: [], weaknesses: [], notes: ['long-winded'],
            overallRankLabel: '???', isDrafted: false, personalRank: 12,
        }]);

        const doc = storedDoc('p_2');
        expect(Object.keys(doc).sort()).toEqual(['g', 'p', 'r']);
        expect(doc.strengths).toBeUndefined();
        expect(doc.notes).toBeUndefined();
    });

    it('never writes a long field name, whatever it is handed', async () => {
        await writeEntries(BOARD, [{
            playerId: 'p_3', position: 'WR', round: 3,
            somethingNobodyHasThoughtOfYet: 'value',
        }]);

        const doc = storedDoc('p_3');
        Object.keys(doc).forEach(k => expect(k.length).toBe(1));
    });

    it('does not lose the tag when other fields are present', async () => {
        // The symptom that found this: an expert's edit left the shared board
        // with fewer tagged entries than it started with.
        await writeEntries(BOARD, [{ playerId: 'p_4', position: 'QB', round: 1, tag: 'monitor', strengths: [] }]);
        expect(storedDoc('p_4').g).toBe('monitor');
    });

    it('round-trips a board’s own athletic-matrix override', async () => {
        // Declared by makeEntry, missing from the map, null on all 984 entries
        // of the shipped season — so it would have been written under its long
        // name the first time a board actually overrode one.
        await writeEntries(BOARD, [{
            playerId: 'p_5', position: 'RB', round: 2,
            athleticMatrixTotal: 88, athleticMatrixPosition: 3,
        }]);

        const doc = storedDoc('p_5');
        expect(doc.m).toBe(88);
        expect(doc.n).toBe(3);
        expect(entryFields.fat(doc)).toMatchObject({ athleticMatrixTotal: 88, athleticMatrixPosition: 3 });

        const back = readEntries(BOARD).find(e => e.playerId === 'p_5');
        expect(back.athleticMatrixTotal).toBe(88);
    });
});
