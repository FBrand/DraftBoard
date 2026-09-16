import { describe, it, expect } from 'vitest';
import { canonicalPosition, samePosition, rowsFor, COVERS } from '../../src/utils/positionTaxonomy';

/**
 * What a man plays, versus where he lines up.
 *
 * The distinction these tests protect: CONTAINMENT normalises a label and is
 * therefore safe for identity, while COMPATIBILITY says two DIFFERENT
 * positions can fill one row and must never touch identity. Collapsing OT and
 * IOL would merge two men who share a name, one a tackle and one a guard.
 */
describe('reading a label', () => {
    it('gives back a position unchanged', () => {
        expect(canonicalPosition('EDGE')).toBe('EDGE');
    });

    it('normalises a depth-chart row to the position that covers it', () => {
        expect(canonicalPosition('LDE')).toBe('EDGE');
        expect(canonicalPosition('RDE')).toBe('EDGE');
        expect(canonicalPosition('LG')).toBe('IOL.G');   // narrowest wins; samePosition still ties it to IOL
        expect(canonicalPosition('DT.1T')).toBe('DL.1T');   // narrowest, not plain DL
    });

    it('reads the vocabulary other sources use', () => {
        expect(canonicalPosition('DE')).toBe('EDGE');
        expect(canonicalPosition('OG')).toBe('IOL.G');
        expect(canonicalPosition('NT')).toBe('DL.1T');
        expect(canonicalPosition('Edge')).toBe('EDGE');
    });

    it('treats URA as no position at all, because it is not one', () => {
        expect(canonicalPosition('URA')).toBe('');
    });

    it('falls back to the major for a sub-type nobody declared', () => {
        expect(canonicalPosition('DL.7T')).toBe('DL');
    });

    it('leaves a label it does not know alone rather than guessing', () => {
        // DB and OL name a GROUP. Guessing which half is meant is how a wrong
        // record gets written confidently.
        expect(canonicalPosition('DB')).toBe('DB');
        expect(canonicalPosition('OL')).toBe('OL');
    });
});

describe('same position?', () => {
    it('sees through an alignment, which closes the duplicate records', () => {
        // Seven of the twelve duplicates found were exactly this shape.
        expect(samePosition('EDGE', 'LDE')).toBe(true);
        expect(samePosition('LDE', 'RDE')).toBe(true);
        expect(samePosition('OG', 'LG')).toBe(true);
        // A nose tackle IS a defensive tackle — this is the Seumalo pair.
        expect(samePosition('DT', 'NT')).toBe(true);
        expect(samePosition('IOL', 'C')).toBe(true);
        // But two DIFFERENT sub-types are two different things.
        expect(samePosition('DL.1T', 'DL.3T')).toBe(false);
    });

    it('keeps two different positions apart even when they are compatible', () => {
        // The whole point. A tackle can PLAY guard; he is not a guard, and two
        // men sharing a name must not merge because of it.
        expect(samePosition('OT', 'IOL')).toBe(false);
        expect(samePosition('CB', 'S')).toBe(false);
        expect(samePosition('EDGE', 'LB')).toBe(false);
    });

    it('does not let an unknown on either side count as a difference', () => {
        expect(samePosition('EDGE', '')).toBe(true);
        expect(samePosition('URA', 'OT')).toBe(true);
    });
});

describe('which rows can he fill', () => {
    it('gives the rows his own position covers', () => {
        expect(rowsFor('EDGE').sort()).toEqual(['LDE', 'RDE']);
        // IOL also gains the tackle rows, because OT and IOL are declared
        // compatible — that is placement, and it is the point of rowsFor.
        expect(rowsFor('IOL').sort()).toEqual(['C', 'LG', 'LT', 'RG', 'RT']);
    });

    it('answers for a man labelled by an alignment', () => {
        expect(rowsFor('LDE').sort()).toEqual(['LDE', 'RDE']);
    });

    it('includes a compatible position, which is what placement is for', () => {
        // #22: an OT finds no row when the chart offers LT and RT.
        expect(rowsFor('OT')).toContain('LT');
        expect(rowsFor('OT')).toContain('RT');
        expect(rowsFor('OT')).toContain('LG');
    });

    it('is empty for a label that denotes nothing', () => {
        expect(rowsFor('URA')).toEqual([]);
    });
});

describe('the table itself', () => {
    it('covers every row the shipped depth chart defines', () => {
        const rows = ['WR.Z', 'WR.X', 'WR.S', 'LT', 'LG', 'C', 'RG', 'RT', 'TE', 'QB', 'RB',
            'LDE', 'DT.3T', 'DT.1T', 'RDE', 'LB.W', 'LB.M', 'CB.L', 'S.S', 'S.F', 'CB.R', 'CB.N',
            'P', 'K', 'LS'];
        const covered = new Set(Object.values(COVERS).flat());
        expect(rows.filter(r => !covered.has(r))).toEqual([]);
    });
});
