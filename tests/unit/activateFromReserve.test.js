import { describe, it, expect } from 'vitest';
import { clearInjuryArrival } from '../../src/utils/rosterState';

/**
 * Coming back off injured reserve.
 *
 * Being IN the reserve list is what injured means — there is no separate flag —
 * so dropping a player there puts him on it and dragging him out takes him off.
 * That is the whole interaction. There was briefly a button doing the second
 * half, which was a second way of saying what the drag already said.
 *
 * The one rule worth keeping is about the tag he carries back.
 */
describe('the arrival a player keeps when he is activated', () => {
    it('drops IR, which was never an arrival — it is a status in an arrival’s clothes', () => {
        // "Name:IR" in a roster file says he is hurt, not how he got here. Once
        // he is healthy it is simply wrong, and a plain veteran is the honest
        // answer when nobody recorded anything else.
        expect(clearInjuryArrival('IR')).toBeNull();
    });

    it('keeps a real one, because a free agent who got hurt is still a free agent', () => {
        expect(clearInjuryArrival('FA')).toBe('FA');
        expect(clearInjuryArrival('UDFA')).toBe('UDFA');
        expect(clearInjuryArrival('24/1')).toBe('24/1');
    });

    it('leaves a player who arrived with no tag without one', () => {
        expect(clearInjuryArrival(null)).toBeNull();
        expect(clearInjuryArrival(undefined)).toBeNull();
    });
});
