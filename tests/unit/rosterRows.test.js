import { describe, it, expect } from 'vitest';
import { deletePositionRow, parseCSV, exportCSV, makeSlot } from '../../src/utils/rosterState';

/**
 * Position rows, and the holes players leave in them.
 *
 * Replaces the data half of `roster-slots.spec.js`: "deleting a position row
 * moves its players to cuts rather than losing them", and "a player after a
 * hole still renders in every zone" — the part of that which is about the
 * hole surviving at all, rather than about how it draws.
 *
 * A depth chart is a SPARSE array. Slot 3 being empty while slot 4 is taken is
 * ordinary — it is a gap in the depth chart, not a bug — and every path that
 * touches one has to leave the gap where it is rather than closing it up and
 * quietly promoting everybody behind it.
 */
const state = () => ({
    positionConfig: {
        offense: [{ id: 'wrz', label: 'WR.Z', slots53: 3 }, { id: 'qb', label: 'QB', slots53: 2 }],
        defense: [{ id: 'edge', label: 'EDGE', slots53: 2 }],
    },
    depthChart: {
        wrz: [makeSlot('Rashee Rice'), null, makeSlot('Xavier Worthy', '53', 'FA')],
        qb: [makeSlot('Patrick Mahomes')],
        edge: [],
    },
    reserve: [],
    cuts: [],
});

describe('deleting a position row', () => {
    it('drops the row and the chart it kept', () => {
        const after = deletePositionRow(state(), 'offense', 'wrz');
        expect(after.positionConfig.offense.map(p => p.id)).toEqual(['qb']);
        expect(after.depthChart.wrz).toBeUndefined();
    });

    it('moves everybody who was in it to cuts, rather than orphaning them', () => {
        const after = deletePositionRow(state(), 'offense', 'wrz');
        expect(after.cuts.map(s => s.name)).toEqual(['Rashee Rice', 'Xavier Worthy']);
    });

    it('carries how each of them arrived, so a free agent stays a free agent', () => {
        const after = deletePositionRow(state(), 'offense', 'wrz');
        expect(after.cuts.find(s => s.name === 'Xavier Worthy').arrival).toBe('FA');
    });

    it('does not count the hole as a player', () => {
        const after = deletePositionRow(state(), 'offense', 'wrz');
        expect(after.cuts).toHaveLength(2);
        expect(after.cuts.every(Boolean)).toBe(true);
    });

    it('leaves an empty row without inventing a cut', () => {
        const after = deletePositionRow(state(), 'defense', 'edge');
        expect(after.cuts).toEqual([]);
        expect(after.positionConfig.defense).toEqual([]);
    });

    it('appends to cuts already there rather than replacing them', () => {
        const before = { ...state(), cuts: [makeSlot('Somebody Earlier', 'cut')] };
        const after = deletePositionRow(before, 'offense', 'qb');
        expect(after.cuts.map(s => s.name)).toEqual(['Somebody Earlier', 'Patrick Mahomes']);
    });

    it('touches nothing else', () => {
        const before = state();
        const after = deletePositionRow(before, 'offense', 'wrz');
        expect(after.depthChart.qb).toEqual(before.depthChart.qb);
        expect(after.positionConfig.defense).toEqual(before.positionConfig.defense);
        expect(before.depthChart.wrz).toHaveLength(3); // the input is not mutated
    });
});

describe('a hole in a depth chart', () => {
    // Cut a player out of the middle of a row and the cell stays behind — it
    // is where you drop the next one, so the live state is sparse on purpose.
    // The FILE is not. Each section is written contiguously, because a blank
    // cell that could mean either "a gap here" or "nothing more in this row"
    // is a blank cell the reader cannot interpret.
    it('is not written to the file', () => {
        const csv = exportCSV(state());
        const wrz = csv.split('\n').find(r => r.startsWith('O,WR.Z'));
        expect(wrz).toBe('O,WR.Z,3,Rashee Rice,Xavier Worthy:FA');
    });

    it('closes up on the way out, keeping the order and the arrivals', () => {
        const back = parseCSV(exportCSV(state()));
        const wrz = back.depthChart[Object.keys(back.depthChart).find(k => k.includes('WR.Z'))];

        expect(wrz.filter(Boolean).map(s => s.name)).toEqual(['Rashee Rice', 'Xavier Worthy']);
        expect(wrz.find(s => s?.name === 'Xavier Worthy').arrival).toBe('FA');
    });

    it('keeps each section to itself — a 53 man is not promoted into the reserves', () => {
        const withBands = {
            ...state(),
            depthChart: {
                ...state().depthChart,
                wrz: [
                    makeSlot('Rashee Rice'),
                    null,
                    makeSlot('Xavier Worthy', '53', 'FA'),
                    makeSlot('A Squad Player', 'ps'),
                    null,
                    makeSlot('A Reserve', 'r'),
                ],
            },
        };
        const back = parseCSV(exportCSV(withBands));
        const wrz = back.depthChart[Object.keys(back.depthChart).find(k => k.includes('WR.Z'))];
        const zoneOf = (name) => wrz.find(s => s?.name === name)?.zone;

        expect(zoneOf('Rashee Rice')).toBe('53');
        expect(zoneOf('Xavier Worthy')).toBe('53');
        expect(zoneOf('A Squad Player')).toBe('ps');
        expect(zoneOf('A Reserve')).toBe('r');
    });
});
