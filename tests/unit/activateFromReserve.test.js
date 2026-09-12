import { describe, it, expect } from 'vitest';
import { activateFromReserve, firstFreeSlot, makeSlot } from '../../src/utils/rosterState';

/**
 * Coming back off injured reserve.
 *
 * Going ON was a drag to the IR zone and coming back off was nothing at all,
 * so a roster could only ever accumulate injuries across a session.
 *
 * Being in the reserve list is what "injured" means here — there is no
 * separate flag — so activating a player is a move. The only subtlety is the
 * tag he carries back with him.
 */
const state = (overrides = {}) => ({
    positionConfig: {
        offense: [{ id: 'wrz', label: 'WR.Z', slots53: 2 }],
        defense: [{ id: 'dl', label: 'DL.3T', slots53: 1 }],
    },
    depthChart: { wrz: [], dl: [] },
    reserve: [],
    cuts: [],
    ...overrides,
});

const namesIn = (s, row) => (s.depthChart[row] ?? []).filter(Boolean).map(x => x.name);

describe('the ladder a returning player is placed on', () => {
    it('takes the first free 53-man slot', () => {
        expect(firstFreeSlot([], 2)).toEqual({ index: 0, zone: '53', label: '53-man' });
        expect(firstFreeSlot([makeSlot('A')], 2)).toEqual({ index: 1, zone: '53', label: '53-man' });
    });

    it('falls to the practice squad when the 53 is full', () => {
        expect(firstFreeSlot([makeSlot('A'), makeSlot('B')], 2))
            .toEqual({ index: 2, zone: 'ps', label: 'practice squad' });
    });

    it('falls to the reserves when the squad is full too', () => {
        const full = [makeSlot('A'), makeSlot('B'), makeSlot('C'), makeSlot('D'), makeSlot('E')];
        expect(firstFreeSlot(full, 2)).toEqual({ index: 5, zone: 'r', label: 'reserve' });
    });
});

describe('activating a player', () => {
    it('moves him out of the reserve list and into his position row', () => {
        const out = activateFromReserve(
            state({ reserve: [makeSlot('Omarr Norman-Lott', 'ir', 'IR')] }), 0, 'DL.3T',
        );

        expect(out.reason).toBeNull();
        expect(out.next.reserve).toEqual([]);
        expect(namesIn(out.next, 'dl')).toEqual(['Omarr Norman-Lott']);
        expect(out.placed).toEqual({ label: '53-man', zone: '53', row: 'DL.3T' });
    });

    it('drops an IR tag, because it described nothing but the injury', () => {
        // A player imported as `Name:IR` has "IR" as his arrival only because
        // the file had nothing else to say about him. Once he is healthy that
        // tag is simply wrong, and a plain veteran is the honest answer.
        const out = activateFromReserve(
            state({ reserve: [makeSlot('Omarr Norman-Lott', 'ir', 'IR')] }), 0, 'DL.3T',
        );
        expect(out.next.depthChart.dl[0].arrival ?? null).toBeNull();
    });

    it('keeps a real arrival, because a free agent who got hurt is still a free agent', () => {
        const out = activateFromReserve(
            state({ reserve: [makeSlot('Andrew Armstrong', 'ir', 'FA')] }), 0, 'WR.Z',
        );
        expect(out.next.depthChart.wrz[0].arrival).toBe('FA');
    });

    it('puts him on the practice squad when the 53 is full rather than refusing', () => {
        const out = activateFromReserve(state({
            depthChart: { wrz: [makeSlot('One'), makeSlot('Two')], dl: [] },
            reserve: [makeSlot('Andrew Armstrong', 'ir', 'FA')],
        }), 0, 'WR.Z');

        expect(out.placed.label).toBe('practice squad');
        expect(out.next.depthChart.wrz[2].zone).toBe('ps');
    });

    it('refuses when the depth chart has no row for him, rather than guessing one', () => {
        const out = activateFromReserve(
            state({ reserve: [makeSlot('A Kicker', 'ir', 'IR')] }), 0, 'K',
        );

        expect(out.reason).toBe('no-row');
        expect(out.placed).toBeNull();
        expect(out.next.reserve).toHaveLength(1); // still there, nothing lost
    });

    it('refuses when nobody is at that index', () => {
        const out = activateFromReserve(state(), 0, 'WR.Z');
        expect(out.reason).toBe('not-on-reserve');
        expect(out.next).toEqual(state());
    });

    it('reads an older save that stored a bare name', () => {
        const out = activateFromReserve(state({ reserve: ['Omarr Norman-Lott'] }), 0, 'DL.3T');
        expect(namesIn(out.next, 'dl')).toEqual(['Omarr Norman-Lott']);
    });

    it('takes the right man out when several are on reserve', () => {
        const out = activateFromReserve(state({
            reserve: [makeSlot('First', 'ir', 'IR'), makeSlot('Second', 'ir', 'IR'), makeSlot('Third', 'ir', 'IR')],
        }), 1, 'WR.Z');

        expect(out.next.reserve.map(s => s.name)).toEqual(['First', 'Third']);
        expect(namesIn(out.next, 'wrz')).toEqual(['Second']);
    });

    it('does not mutate the state it was given', () => {
        const before = state({ reserve: [makeSlot('Omarr Norman-Lott', 'ir', 'IR')] });
        activateFromReserve(before, 0, 'DL.3T');
        expect(before.reserve).toHaveLength(1);
        expect(before.depthChart.dl).toEqual([]);
    });
});
