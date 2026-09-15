import { describe, it, expect } from 'vitest';
import {
    renamer, playerFields, entryFields, rowFields, slotFields,
} from '../../src/data/fieldNames';

/**
 * The rename has to be a bijection, and these tests are the only thing that
 * says so.
 *
 * A duplicate short name does not throw at runtime and does not fail a render.
 * It writes one field over another, and the loss shows up much later as a
 * player with somebody else's school. That is the single mistake this file can
 * make, so it is checked at module load and again here.
 */
const ALL = { playerFields, entryFields, rowFields, slotFields };

describe('every map is reversible', () => {
    Object.entries(ALL).forEach(([name, fields]) => {
        it(`${name}: no two long names share a short one`, () => {
            const shorts = Object.values(fields.map);
            expect(new Set(shorts).size, `duplicate in ${name}`).toBe(shorts.length);
        });

        it(`${name}: round-trips a document carrying every field`, () => {
            const full = Object.fromEntries(
                Object.keys(fields.map).map((k, i) => [k, `value-${i}`]),
            );
            expect(fields.fat(fields.lean(full))).toEqual(full);
        });

        it(`${name}: a short name is not also somebody's long name`, () => {
            // Otherwise an unmapped field called `p` would come back as
            // `position`, silently.
            Object.keys(fields.map).forEach(long => {
                expect(fields.reverse[long] ?? long, `${name}.${long}`).toBe(long);
            });
        });
    });
});

describe('what it does to a document', () => {
    it('shortens what it knows and leaves what it does not', () => {
        const lean = playerFields.lean({
            name: 'Fernando Mendoza', position: 'QB', draftPick: 1, somethingNew: true,
        });
        expect(lean).toEqual({ n: 'Fernando Mendoza', p: 'QB', k: 1, somethingNew: true });
    });

    it('brings an unmapped field back untouched, so adding one costs bytes not data', () => {
        const doc = { name: 'X', somethingNew: true };
        expect(playerFields.fat(playerFields.lean(doc))).toEqual(doc);
    });

    it('keeps false, zero and null rather than treating them as absent', () => {
        const doc = { hidden: false, draftPick: 0, team: null };
        expect(playerFields.fat(playerFields.lean(doc))).toEqual(doc);
    });

    it('survives an empty document and a nullish one', () => {
        expect(playerFields.lean({})).toEqual({});
        expect(playerFields.fat(null)).toEqual({});
        expect(playerFields.lean(undefined)).toEqual({});
    });
});

describe('the maps that matter', () => {
    it('shortens the fields that were measured as the worst', () => {
        // createdAt and updatedAt alone were 17,592 characters of field NAME
        // in the registry; withinGroup was 4,382 on one board.
        expect(playerFields.map.createdAt).toHaveLength(1);
        expect(playerFields.map.updatedAt).toHaveLength(1);
        expect(entryFields.map.withinGroup).toHaveLength(1);
        expect(entryFields.map.position).toHaveLength(1);
    });

    it('does not map a field that is never stored', () => {
        // The key says who; the registry says the name and school. Mapping
        // them here would imply they belong in an entry.
        expect(entryFields.map.playerId).toBeUndefined();
        expect(entryFields.map.name).toBeUndefined();
        expect(entryFields.map.school).toBeUndefined();
        expect(rowFields.map.rowId).toBeUndefined();
    });
});

describe('the guard', () => {
    it('refuses a map with a duplicate short name', () => {
        expect(() => renamer({ one: 'a', two: 'a' }, 'test'))
            .toThrow(/short name for both/);
    });

    it('refuses a short name that is also a long name', () => {
        expect(() => renamer({ a: 'x', b: 'a' }, 'test'))
            .toThrow(/both a long name and the short name/);
    });
});
