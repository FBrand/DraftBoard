import { describe, it, expect, beforeEach } from 'vitest';
import {
    rankBoard, moveToRank, between, spaceEvenly,
    parseTier, tierLabel, tierKey, compareTiers, basePosition,
} from '../../src/utils/boardRanking.js';
import { setPositionValue } from '../../src/utils/appSettings.js';

beforeEach(() => { globalThis.resetStorage(); });

const player = (name, position, round, tier, overallRank) =>
    ({ name, position, round, tier, overallRank });
const noEntries = () => null;

describe('the ordering rules, in order', () => {
    it('puts tiers above everything else', () => {
        const ranked = rankBoard([
            player('Late', 'QB', 1, 3, 1),      // best source rank, worst tier
            player('Early', 'RB', 1, 2, 99),
        ], noEntries);
        expect(ranked.map(p => p.name)).toEqual(['Early', 'Late']);
    });

    it('keeps the source file order inside a tier', () => {
        // Positional value would put the QB first; the file's own order is
        // real information an analyst put there and outranks it.
        const ranked = rankBoard([
            player('Runner', 'RB', 1, 1, 1),
            player('Passer', 'QB', 1, 1, 2),
        ], noEntries);
        expect(ranked.map(p => p.name)).toEqual(['Runner', 'Passer']);
    });

    it('falls back to positional value only when the source is silent', () => {
        const ranked = rankBoard([
            player('Runner', 'RB', 1, 1, null),
            player('Passer', 'QB', 1, 1, null),
        ], noEntries);
        expect(ranked.map(p => p.name)).toEqual(['Passer', 'Runner']);
    });

    it('follows a positional value the user has changed', () => {
        setPositionValue('RB, QB');
        const ranked = rankBoard([
            player('Passer', 'QB', 1, 1, null),
            player('Runner', 'RB', 1, 1, null),
        ], noEntries);
        expect(ranked.map(p => p.name)).toEqual(['Runner', 'Passer']);
    });

    it('lets an explicit choice beat both', () => {
        const entries = { Passer: { round: 1, tier: 1, withinGroup: 2 },
                          Runner: { round: 1, tier: 1, withinGroup: 1 } };
        const ranked = rankBoard([
            player('Passer', 'QB', 1, 1, 1),
            player('Runner', 'RB', 1, 1, 2),
        ], (name) => entries[name]);
        expect(ranked.map(p => p.name)).toEqual(['Runner', 'Passer']);
    });
});

describe('an unranked player has no rank, not the worst one', () => {
    it('gives him null and sorts him last', () => {
        const ranked = rankBoard([
            player('Unplaced', 'QB', null, null, null),
            player('Placed', 'RB', 1, 1, 1),
        ], noEntries);
        expect(ranked.map(p => p.name)).toEqual(['Placed', 'Unplaced']);
        expect(ranked[1].overallRank).toBeNull();
        expect(ranked[1].positionRank).toBeNull();
    });

    it('does not let him consume a rank number', () => {
        const ranked = rankBoard([
            player('A', 'QB', 1, 1, 1),
            player('Unplaced', 'QB', null, null, null),
            player('B', 'QB', 1, 2, 2),
        ], noEntries);
        // B is second, not third — the unplaced player took no number.
        expect(ranked.find(p => p.name === 'B').overallRank).toBe(2);
    });
});

describe('position rank is read off the same ordering', () => {
    it('counts per position, so it cannot disagree with the board', () => {
        const ranked = rankBoard([
            player('QB1', 'QB', 1, 1, 1),
            player('WR1', 'WR', 1, 1, 2),
            player('QB2', 'QB', 1, 2, 3),
        ], noEntries);
        expect(ranked.find(p => p.name === 'QB2').positionRank).toBe(2);
        expect(ranked.find(p => p.name === 'WR1').positionRank).toBe(1);
    });

    it('counts a depth-suffixed position as its base', () => {
        expect(basePosition('WR.Z')).toBe('WR');
        const ranked = rankBoard([
            player('A', 'WR.Z', 1, 1, 1),
            player('B', 'WR.X', 1, 2, 2),
        ], noEntries);
        expect(ranked.find(p => p.name === 'B').positionRank).toBe(2);
    });
});

// withinGroup is a float so a move writes one number on one player rather
// than renumbering everyone below him.
describe('placement is a value between neighbours', () => {
    it('takes the midpoint of two players in the same tier', () => {
        const before = { round: 1, tier: 1, withinGroup: 1 };
        const after = { round: 1, tier: 1, withinGroup: 2 };
        expect(between(before, after, 1, 1)).toBe(1.5);
    });

    it('ignores a neighbour from another tier', () => {
        // A player in the tier above says nothing about where this one goes
        // within this tier.
        const otherTier = { round: 1, tier: 1, withinGroup: 5 };
        const inTier = { round: 1, tier: 2, withinGroup: 4 };
        expect(between(otherTier, inTier, 1, 2)).toBe(3);
    });

    it('handles the ends of a tier and an empty one', () => {
        expect(between({ round: 1, tier: 1, withinGroup: 3 }, null, 1, 1)).toBe(4);
        expect(between(null, { round: 1, tier: 1, withinGroup: 3 }, 1, 1)).toBe(2);
        expect(between(null, null, 1, 1)).toBe(1);
    });

    it('spaces a freshly seeded tier so later midpoints have room', () => {
        expect(spaceEvenly(0)).toBe(1);
        expect(spaceEvenly(1)).toBe(2);
        expect(between({ round: 1, tier: 1, withinGroup: spaceEvenly(0) },
                       { round: 1, tier: 1, withinGroup: spaceEvenly(1) }, 1, 1)).toBe(1.5);
    });
});

describe('moving to a rank moves one player', () => {
    const board = [
        player('A', 'QB', 1, 1, 1), player('B', 'QB', 1, 1, 2),
        player('C', 'QB', 1, 2, 3), player('D', 'QB', 1, 2, 4),
    ].map((p, i) => ({ ...p, withinGroup: i + 1 }));

    it('adopts the tier of whoever he lands beside', () => {
        // Moving to rank 4 puts him among the second tier.
        const moved = moveToRank(board, 'A', 4);
        expect(moved.round).toBe(1);
        expect(moved.tier).toBe(2);
    });

    it('returns a placement, not a new ordering of the board', () => {
        const moved = moveToRank(board, 'D', 1);
        expect(moved).toHaveProperty('withinGroup');
        expect(moved).not.toHaveProperty('order');
        expect(typeof moved.withinGroup).toBe('number');
    });

    it('refuses a player who is not on the board', () => {
        expect(moveToRank(board, 'Nobody', 1)).toBeNull();
    });
});

// round and tier are two stored numbers; "1.3" survives only at the CSV edge.
describe('the joined tier label is a boundary format', () => {
    it('parses and re-emits', () => {
        expect(parseTier('1.3')).toEqual({ round: 1, tier: 3 });
        expect(parseTier('2')).toEqual({ round: 2, tier: null });
        expect(parseTier('')).toEqual({ round: null, tier: null });
        expect(tierLabel(1, 3)).toBe('1.3');
        expect(tierLabel(2, null)).toBe('2');
        expect(tierLabel(null, null)).toBe('');
    });

    it('gives unplaced players one shared key rather than many', () => {
        expect(tierKey(null, null)).toBe('unranked');
        expect(tierKey(1, 3)).toBe('1.3');
    });

    it('sorts rounds then tiers, unplaced last', () => {
        const order = [
            { round: null, tier: null }, { round: 2, tier: 1 },
            { round: 1, tier: 2 }, { round: 1, tier: 1 },
        ].sort(compareTiers);
        expect(order).toEqual([
            { round: 1, tier: 1 }, { round: 1, tier: 2 },
            { round: 2, tier: 1 }, { round: null, tier: null },
        ]);
    });
});
