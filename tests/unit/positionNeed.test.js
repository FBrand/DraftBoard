import { describe, it, expect } from 'vitest';
import { computePositionNeed } from '../../src/utils/faState';

/**
 * How short each position is, for the free-agency board.
 *
 * Pure by design — it takes the snapshot rather than reading the roster, so
 * that free agency can never write to a chart it only wants to look at. The
 * subtlety it already records: measure the board you are STANDING ON, because
 * free agency happens before the draft, and Roster holds what the draft
 * produced.
 */
const chart = (rows) => ({
    positionConfig: {
        offense: rows.filter(r => r.phase !== 'D').map(r => ({ id: r.id, label: r.label, slots53: r.slots53 })),
        defense: rows.filter(r => r.phase === 'D').map(r => ({ id: r.id, label: r.label, slots53: r.slots53 })),
    },
    depthChart: Object.fromEntries(rows.map(r => [r.id, r.slots ?? []])),
});

const slot = (name) => ({ name, zone: '53' });

describe('what a position still needs', () => {
    it('counts the filled leading slots against the target', () => {
        const needs = computePositionNeed(chart([
            { id: 'r1', label: 'QB', slots53: 2, slots: [slot('Mahomes')] },
        ]));
        expect(needs.QB).toEqual({ filled: 1, target: 2, stillNeed: 1 });
    });

    it('counts nothing beyond the 53-man slots', () => {
        // A practice-squad body behind the line does not fill a hole in it.
        const needs = computePositionNeed(chart([
            { id: 'r1', label: 'WR', slots53: 2, slots: [slot('One'), null, slot('Deep')] },
        ]));
        expect(needs.WR).toEqual({ filled: 1, target: 2, stillNeed: 1 });
    });

    it('does not go negative when a row is over-filled', () => {
        const needs = computePositionNeed(chart([
            { id: 'r1', label: 'RB', slots53: 1, slots: [slot('One'), slot('Two')] },
        ]));
        expect(needs.RB.stillNeed).toBe(0);
    });

    it('reads defence as well as offence', () => {
        const needs = computePositionNeed(chart([
            { id: 'r1', label: 'QB', slots53: 1, slots: [slot('Mahomes')] },
            { id: 'r2', label: 'CB', slots53: 3, phase: 'D', slots: [slot('One')] },
        ]));
        expect(needs.CB).toEqual({ filled: 1, target: 3, stillNeed: 2 });
    });

    it('treats a row with no slots as entirely unfilled', () => {
        const needs = computePositionNeed(chart([{ id: 'r1', label: 'TE', slots53: 2 }]));
        expect(needs.TE).toEqual({ filled: 0, target: 2, stillNeed: 2 });
    });

    it('answers for no snapshot at all', () => {
        expect(computePositionNeed(null)).toEqual({});
        expect(computePositionNeed(undefined)).toEqual({});
    });

    it('never reports NaN, whatever the row says its target is', () => {
        // Math.max(undefined, 1) is NaN, and NaN reaches the screen as
        // "still need NaN". The same shape renders a row with no slots at all
        // in DepthChartGrid, which is why the storage test pins it too.
        const needs = computePositionNeed(chart([
            { id: 'r1', label: 'K', slots53: undefined, slots: [slot('Butker')] },
        ]));
        expect(Number.isNaN(needs.K.target)).toBe(false);
        expect(Number.isNaN(needs.K.stillNeed)).toBe(false);
        expect(needs.K.target).toBeGreaterThanOrEqual(1);
    });
});
