import { describe, it, expect } from 'vitest';
import { syncFromStages, describeSync } from '../../src/utils/rosterSync';
import { makeSlot } from '../../src/utils/rosterState';

/**
 * Filling the roster from Free Agency, the draft and UDFA.
 *
 * Covers what the old browser suite proved by driving the button:
 * `init-modes.spec.js` "clean slate can sync FA, draft picks and UDFA into the
 * roster", "a roster signing takes no pick and does not land on IR", and
 * `ui.spec.js` "the sync action reports what it did".
 *
 * The whole value of this action is that it is safe to run twice, so most of
 * what is worth asserting is what it does NOT do.
 */
const roster = (overrides = {}) => ({
    positionConfig: {
        offense: [
            { id: 'qb', label: 'QB', slots53: 2 },
            { id: 'wrz', label: 'WR.Z', slots53: 2 },
        ],
        defense: [
            { id: 'edge', label: 'EDGE', slots53: 1 },
        ],
    },
    depthChart: { qb: [], wrz: [], edge: [] },
    reserve: [],
    cuts: [],
    ...overrides,
});

const fa = (rows) => ({
    positionConfig: { offense: [{ id: 'f1', label: 'QB', slots53: 2 }], defense: [] },
    depthChart: rows,
});

const namesIn = (state, row) => (state.depthChart[row] ?? []).filter(Boolean).map(s => s.name);

describe('syncing the roster from the earlier stages', () => {
    it('takes a candidate from free agency, a pick, and a UDFA signing', () => {
        const out = syncFromStages({
            state: roster(),
            fa: fa({ f1: [makeSlot('Justin Fields', '53', 'FA')] }),
            draftedPlayers: [
                { name: 'Arvell Reese', position: 'EDGE', draftedByUs: true, pickNumber: 21 },
                { name: 'Joey Aguilar', position: 'WR.Z', draftedByUs: true, pickNumber: 'UDFA' },
            ],
        });

        expect(out.changed).toBe(true);
        expect(out.placed).toBe(3);
        expect(namesIn(out.next, 'qb')).toEqual(['Justin Fields']);
        expect(namesIn(out.next, 'edge')).toEqual(['Arvell Reese']);
        expect(namesIn(out.next, 'wrz')).toEqual(['Joey Aguilar']);
    });

    it('ignores another team’s picks, and hands back the state it was given', () => {
        const before = roster();
        const out = syncFromStages({
            state: before,
            draftedPlayers: [{ name: 'Somebody Else', position: 'QB', draftedByUs: false, pickNumber: 4 }],
        });
        expect(out.placed).toBe(0);
        expect(out.changed).toBe(false);
        expect(out.next).toBe(before); // the same object, not a copy
        expect(namesIn(out.next, 'qb')).toEqual([]);
    });

    it('never overwrites a placement made by hand, and running it twice is a no-op', () => {
        const first = syncFromStages({
            state: roster(),
            fa: fa({ f1: [makeSlot('Justin Fields', '53', 'FA')] }),
        });
        // Somebody then puts a starter above him by hand.
        const edited = {
            ...first.next,
            depthChart: { ...first.next.depthChart, qb: [makeSlot('Patrick Mahomes'), first.next.depthChart.qb[0]] },
        };

        const second = syncFromStages({ state: edited, fa: fa({ f1: [makeSlot('Justin Fields', '53', 'FA')] }) });

        expect(second.placed).toBe(0);
        expect(second.alreadyPresent).toBe(1);
        expect(namesIn(second.next, 'qb')).toEqual(['Patrick Mahomes', 'Justin Fields']);
    });

    it('does not haul back a player who is on the cut list or on reserve', () => {
        // The membership test used to read cuts and reserve as bare names.
        // They hold slots now, so it matched nothing and sync re-signed
        // everybody you had just cut.
        const out = syncFromStages({
            state: roster({
                cuts: [makeSlot('Justin Fields', 'cut', 'FA')],
                reserve: [makeSlot('Arvell Reese', 'reserve')],
            }),
            fa: fa({ f1: [makeSlot('Justin Fields', '53', 'FA')] }),
            draftedPlayers: [{ name: 'Arvell Reese', position: 'EDGE', draftedByUs: true, pickNumber: 21 }],
        });

        expect(out.placed).toBe(0);
        expect(out.alreadyPresent).toBe(2);
        expect(namesIn(out.next, 'qb')).toEqual([]);
        expect(namesIn(out.next, 'edge')).toEqual([]);
    });

    it('skips a full row rather than overflowing into the practice squad', () => {
        const out = syncFromStages({
            state: roster({ depthChart: { qb: [], wrz: [], edge: [makeSlot('George Karlaftis')] } }),
            draftedPlayers: [{ name: 'Arvell Reese', position: 'EDGE', draftedByUs: true, pickNumber: 21 }],
        });

        expect(out.placed).toBe(0);
        expect(out.rowFull).toBe(1);
        expect(namesIn(out.next, 'edge')).toEqual(['George Karlaftis']);
    });

    it('skips a position the roster has no row for, rather than inventing one', () => {
        const out = syncFromStages({
            state: roster(),
            draftedPlayers: [{ name: 'A Long Snapper', position: 'LS', draftedByUs: true, pickNumber: 200 }],
        });

        expect(out.placed).toBe(0);
        expect(out.noRow).toBe(1);
        expect(Object.keys(out.next.depthChart).sort()).toEqual(['edge', 'qb', 'wrz']);
    });

    it('puts nobody on injured reserve', () => {
        const out = syncFromStages({
            state: roster(),
            fa: fa({ f1: [makeSlot('Justin Fields', '53', 'FA')] }),
            draftedPlayers: [{ name: 'Arvell Reese', position: 'EDGE', draftedByUs: true, pickNumber: 21 }],
        });
        expect(out.next.reserve).toEqual([]);
        expect(out.next.cuts).toEqual([]);
    });
});

describe('what the sync reports', () => {
    it('counts what it placed', () => {
        expect(describeSync({ placed: 3, noRow: 0, rowFull: 0, alreadyPresent: 0 }))
            .toEqual({ message: 'Placed 3 players.', tone: 'success' });
    });

    it('says one player, not 1 players', () => {
        expect(describeSync({ placed: 1, noRow: 0, rowFull: 0, alreadyPresent: 0 }).message)
            .toBe('Placed 1 player.');
    });

    it('names every reason it skipped somebody', () => {
        const { message } = describeSync({ placed: 2, noRow: 1, rowFull: 3, alreadyPresent: 4 });
        expect(message).toContain('1 had no matching position row');
        expect(message).toContain('3 had no free 53-man slot');
        expect(message).toContain('4 already on the roster');
    });

    it('distinguishes "nothing to do" from "nothing worked"', () => {
        expect(describeSync({ placed: 0, noRow: 0, rowFull: 0, alreadyPresent: 0 }).message)
            .toContain('Nothing to sync');
        expect(describeSync({ placed: 0, noRow: 2, rowFull: 0, alreadyPresent: 0 }).message)
            .toContain('Nothing placed — 2 had no matching position row');
    });
});
