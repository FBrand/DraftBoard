import { describe, it, expect } from 'vitest';
import { makeSlot } from '../../src/utils/rosterState';
import { slotFields } from '../../src/data/fieldNames';

/**
 * A slot says who is standing in it, not just what he is called.
 *
 * It used to carry a name and nothing else, so every read of the depth chart
 * re-derived identity by fuzzy matching, and "is this player still referenced"
 * — the question a prune rule has to answer before deleting anybody — ran
 * through the matcher as well. A false negative there does not mislabel a
 * card; it deletes a man who IS referenced and leaves the slot pointing at a
 * name nothing resolves to.
 */
describe('a slot carries an identity', () => {
    it('keeps the id when one is known', () => {
        expect(makeSlot('Trey Smith', '53', null, 'p_abc12345'))
            .toEqual({ name: 'Trey Smith', zone: '53', playerId: 'p_abc12345' });
    });

    it('still works for a name nobody has resolved yet', () => {
        expect(makeSlot('Nobody Known')).toEqual({ name: 'Nobody Known', zone: '53' });
    });

    it('does not invent an empty id, which would store a lie in every slot', () => {
        expect(makeSlot('Trey Smith', '53', null, null)).not.toHaveProperty('playerId');
    });

    it('survives the short-name round trip the store uses', () => {
        const slot = makeSlot('Trey Smith', 'r', 'FA', 'p_abc12345');
        const lean = slotFields.lean(slot);
        expect(Object.keys(lean).sort()).toEqual(['a', 'i', 'n', 'z']);
        expect(slotFields.fat(lean)).toEqual(slot);
    });
});
