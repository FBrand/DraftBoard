import { describe, it, expect } from 'vitest';
import { joinIndex, findJoin } from '../../src/utils/pickJoin';

/**
 * A pick used to say only the player's NAME, and every reconciliation between
 * the saved draft and a freshly parsed rankings file matched on it. That is
 * the same fault that put Diego Pounds in the registry twice, sitting in the
 * middle of the draft.
 */
const POOL = [
    { id: 'p_mendoza', name: 'Fernando Mendoza', position: 'QB' },
    { id: 'p_reese', name: 'Arvell Reese', position: 'EDGE' },
];

describe('finding the player a pick is about', () => {
    it('asks by id first', () => {
        const idx = joinIndex(POOL);
        expect(findJoin({ playerId: 'p_reese', name: 'anything at all' }, idx)).toBe(1);
    });

    it('survives a correction to his name, which the name join does not', () => {
        // The whole point. Fix a typo in a drafted player's name and his pick
        // must still find him, rather than reconciling as a stranger who
        // happens to have been drafted.
        const idx = joinIndex(POOL);
        const pick = { playerId: 'p_mendoza', name: 'Fernándo Mendozza' };
        expect(findJoin(pick, idx)).toBe(0);
    });

    it('falls back to the name when the pick has no id', () => {
        // Picks written before this existed, and every imported CSV.
        const idx = joinIndex(POOL);
        expect(findJoin({ name: 'Arvell Reese' }, idx)).toBe(1);
    });

    it('falls back when the id is one nothing in the pool carries', () => {
        // A pick can be somebody the current rankings file has never heard of.
        const idx = joinIndex(POOL);
        expect(findJoin({ playerId: 'p_nobody', name: 'Fernando Mendoza' }, idx)).toBe(0);
    });

    it('reports nothing rather than guessing', () => {
        const idx = joinIndex(POOL);
        expect(findJoin({ playerId: 'p_nobody', name: 'Somebody Else' }, idx)).toBe(-1);
        expect(findJoin({}, idx)).toBe(-1);
    });

    it('matches through punctuation and case on the fallback', () => {
        const idx = joinIndex(POOL);
        expect(findJoin({ name: 'arvell  reese' }, idx)).toBe(1);
    });

    it('takes the first of two rows claiming one player, rather than the last', () => {
        // Two rows for one id is a corruption; quietly preferring the later
        // one would hide it.
        const idx = joinIndex([
            { id: 'p_dup', name: 'First Copy' },
            { id: 'p_dup', name: 'Second Copy' },
        ]);
        expect(findJoin({ playerId: 'p_dup', name: 'Second Copy' }, idx)).toBe(0);
    });

    it('reads an id from either `id` or `playerId`, on both sides', () => {
        // The pool calls it `id`; a pick calls it `playerId`.
        const idx = joinIndex([{ playerId: 'p_x', name: 'A Player' }]);
        expect(findJoin({ id: 'p_x', name: 'wrong name' }, idx)).toBe(0);
    });
});
