import { describe, it, expect, beforeEach } from 'vitest';
import {
    canonicalPosition, samePosition, compatiblePositions, rowsFor, COVERS,
    getCompatible, setCompatible, setGroups, parsePairs, parseGroups,
} from '../../src/utils/positionTaxonomy';

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
        // Membership, not equality: EDGE is compatible with DL and LB, so its
        // reachable rows are wider than the ones it covers.
        expect(rowsFor('EDGE')).toContain('LDE');
        expect(rowsFor('EDGE')).toContain('RDE');
        // IOL also gains the tackle rows, because OT and IOL are declared
        // compatible — that is placement, and it is the point of rowsFor.
        expect(rowsFor('IOL').sort()).toEqual(['C', 'LG', 'LT', 'RG', 'RT']);
    });

    it('answers for a man labelled by an alignment', () => {
        expect(rowsFor('LDE')).toContain('LDE');
        expect(rowsFor('LDE')).toContain('RDE');
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

describe('compatibility does not close transitively', () => {
    it('lets an edge rusher play inside, and off the ball', () => {
        expect(rowsFor('EDGE')).toContain('DT.3T');
        expect(rowsFor('EDGE')).toContain('LB.W');
    });

    it('but never puts a linebacker on the interior line', () => {
        // The user's rule: "LB can't play DT and vice versa". EDGE reaches
        // both, so closing the pairs into a graph would walk LB -> EDGE -> DL.
        expect(rowsFor('LB')).not.toContain('DT.1T');
        expect(rowsFor('LB')).not.toContain('DT.3T');
        expect(rowsFor('DL')).not.toContain('LB.W');
        expect(rowsFor('DL')).not.toContain('LB.M');
    });

    it('reads the outside-linebacker vocabularies as linebackers', () => {
        expect(canonicalPosition('OLB')).toBe('LB.O');
        expect(canonicalPosition('LOLB')).toBe('LB.O');
        expect(canonicalPosition('ROLB')).toBe('LB.O');
        // and the 3-4 edge case is reachable for PLACEMENT, not identity
        expect(rowsFor('OLB')).toContain('LDE');
        expect(samePosition('OLB', 'EDGE')).toBe(false);
    });

    it('ties a nose tackle to the interior line', () => {
        expect(samePosition('DL', 'NT')).toBe(true);
        expect(rowsFor('NT')).toContain('DT.1T');
    });
});

describe('labels that name a group', () => {
    it('reaches every member position, so placement can pick by space', () => {
        expect(rowsFor('OL')).toEqual(expect.arrayContaining(['LT', 'RT', 'LG', 'C', 'RG']));
        expect(rowsFor('DB')).toEqual(expect.arrayContaining(['CB.L', 'CB.R', 'CB.N', 'S.S', 'S.F']));
        expect(rowsFor('WR/TE')).toEqual(expect.arrayContaining(['WR.X', 'WR.Z', 'WR.S', 'TE']));
    });

    it('is never resolved to one member, because that would be a guess', () => {
        expect(canonicalPosition('OL')).toBe('OL');
        expect(canonicalPosition('DB')).toBe('DB');
    });

    it('does not run in the inference direction', () => {
        // Reading a man out of a row says the position that covers it, never
        // the group above it.
        expect(canonicalPosition('LG')).toBe('IOL.G');
        expect(canonicalPosition('CB.N')).toBe('CB.N');
    });
});

describe('the editable tables', () => {
    beforeEach(() => { globalThis.resetStorage(); setCompatible([]); setGroups({}); });

    it('reads pairs and groups the way a settings field writes them', () => {
        expect(parsePairs('OT/IOL, EDGE/DL')).toEqual([['OT', 'IOL'], ['EDGE', 'DL']]);
        expect(parseGroups('OL = OT + IOL, DB = CB + S'))
            .toEqual({ OL: ['OT', 'IOL'], DB: ['CB', 'S'] });
    });

    it('takes an edit and lets it change where somebody can be placed', () => {
        // Nothing ties a tight end to the tackle rows by default.
        expect(rowsFor('TE')).not.toContain('LT');
        setCompatible('TE/OT');
        expect(rowsFor('TE')).toContain('LT');
    });

    it('falls back to the shipped tables when the edit is emptied', () => {
        setCompatible('TE/OT');
        setCompatible('');
        expect(rowsFor('OT')).toContain('LG');   // the shipped OT/IOL pair again
    });

    it('ignores nonsense rather than storing it', () => {
        setCompatible('OT, EDGE/, /IOL, OT/IOL');
        expect(getCompatible()).toEqual([['OT', 'IOL']]);
    });

    it('lets a group be redefined', () => {
        // Deliberately a group with nothing in common with the shipped one:
        // redefining OL to OT would still reach guard rows, because a tackle
        // is compatible with IOL — which is the other table doing its job, not
        // this one failing.
        setGroups('OL = TE');
        expect(rowsFor('OL')).toContain('TE');
        expect(rowsFor('OL')).not.toContain('LT');
    });

    it('leaves containment alone — it is not editable, on purpose', () => {
        // Identity compares through containment. An edit that stops two labels
        // matching starts minting duplicate records, which is not a setting.
        expect(samePosition('EDGE', 'LDE')).toBe(true);
        expect(canonicalPosition('LG')).toBe('IOL.G');
    });
});

describe('compatiblePositions — for proposing a match, never for deciding one', () => {
    it('accepts the pairs that actually produced duplicate registry records', () => {
        // Every one of these is a real pair from the live registry, where one
        // man ended up with two records because two sources labelled him
        // differently and neither declared a school.
        expect(compatiblePositions('OT', 'IOL')).toBe(true);
        expect(compatiblePositions('EDGE', 'DL')).toBe(true);
        expect(compatiblePositions('IOL.G', 'OT')).toBe(true);
        expect(compatiblePositions('DL.3T', 'EDGE')).toBe(true);
    });

    it('refuses positions that are genuinely unrelated', () => {
        expect(compatiblePositions('QB', 'CB')).toBe(false);
        expect(compatiblePositions('RB', 'DL')).toBe(false);
        // The taxonomy's own rule: a linebacker is not a defensive tackle.
        expect(compatiblePositions('LB', 'DL.1T')).toBe(false);
    });

    it('is not reflexive — the same position is not a COMPATIBILITY question', () => {
        // samePosition answers that, and answers it strictly. If this returned
        // true the caller could not tell "already matched" from "worth asking".
        expect(compatiblePositions('EDGE', 'EDGE')).toBe(false);
        expect(compatiblePositions('DL', 'DL')).toBe(false);
    });

    it('does not change what samePosition decides', () => {
        // The whole safety property: identity stays strict, so nothing merges
        // at boot where there is nobody to ask.
        expect(samePosition('EDGE', 'DL')).toBe(false);
        expect(samePosition('OT', 'IOL')).toBe(false);
    });
});
