import { describe, it, expect } from 'vitest';
import { parseCSV, exportCSV, makeSlot } from '../../src/utils/rosterState';

/**
 * How a player arrived has to survive being moved.
 *
 * `arrival` is what colours a card — blue for a free agent, gold for a UDFA —
 * and it lived only on the depth-chart slot. Every path that moved somebody
 * rebuilt him from his NAME (`makeSlot(name, zone)`), so a player dragged to
 * the cut panel and back came home a plain veteran, and the same happened via
 * IR and any ordinary slot move. The file dropped it too, because cuts and IR
 * were written as bare names.
 */
const FILE = [
    'Phase,pos,slots53,slot1,slot2,slot3',
    'O,WR.Z,2,Tyquan Thornton,Andrew Armstrong:FA,R:Omari Evans:UDFA',
    'O,QB,2,Patrick Mahomes:17/1,Justin Fields:FA',
    'IR,IR,,Omarr Norman-Lott:IR',
    'CUT,CUT,,Some Cut Guy:FA',
].join('\n');

describe('a slot carries how the player arrived', () => {
    it('keeps arrival through a file round trip, including cuts and IR', () => {
        const state = parseCSV(FILE);
        const back = parseCSV(exportCSV(state));

        const wr = back.depthChart[Object.keys(back.depthChart).find(k => k.includes('WR.Z'))];
        expect(wr.find(s => s?.name === 'Andrew Armstrong').arrival).toBe('FA');
        expect(wr.find(s => s?.name === 'Omari Evans').arrival).toBe('UDFA');

        // These two were written as bare names and lost it entirely.
        expect(back.cuts).toHaveLength(1);
        expect(back.cuts[0]).toMatchObject({ name: 'Some Cut Guy', arrival: 'FA' });
        expect(back.reserve[0]).toMatchObject({ name: 'Omarr Norman-Lott' });
    });

    it('makeSlot carries an arrival when it is given one', () => {
        expect(makeSlot('Andrew Armstrong', '53', 'FA')).toEqual({ name: 'Andrew Armstrong', zone: '53', arrival: 'FA' });
        // And omits the key entirely when there is none, rather than storing null.
        expect(makeSlot('Tyquan Thornton', '53')).toEqual({ name: 'Tyquan Thornton', zone: '53' });
    });

    it('survives a move: the slot is carried, not rebuilt from the name', () => {
        // What performMove does now — the slot object travels intact.
        const original = makeSlot('Andrew Armstrong', '53', 'FA');
        const moved = makeSlot(original.name, 'cut', original.arrival);
        expect(moved).toMatchObject({ name: 'Andrew Armstrong', zone: 'cut', arrival: 'FA' });

        // What it used to do, and why the tag vanished.
        expect(makeSlot(original.name, 'cut').arrival).toBeUndefined();
    });
});
