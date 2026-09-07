import { describe, it, expect } from 'vitest';
import { groupPlayers, missingFor, GROUPINGS } from '../../src/utils/grouping';

const P = (name, o = {}) => ({ name, position: 'WR', school: 'State', round: 1, tier: 1, overallRank: 1, ...o });

describe('grouping a board', () => {
    it('offers the three groupings the view switches between', () => {
        expect(GROUPINGS.map(g => g.id)).toEqual(['position', 'school', 'round']);
    });

    it('groups by base position, ignoring the alignment suffix', () => {
        // "DL.3T" is an alignment; he plays DL, and grouping on the raw label
        // would scatter one position across a column per alignment.
        const { groups } = groupPlayers([
            P('A', { position: 'DL.3T', overallRank: 1 }),
            P('B', { position: 'DL', overallRank: 2 }),
        ], 'position');

        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('DL');
    });

    it('puts the group holding the best player first', () => {
        const { groups } = groupPlayers([
            P('Late', { position: 'QB', overallRank: 40 }),
            P('Early', { position: 'S', overallRank: 2 }),
        ], 'position');

        expect(groups.map(g => g.key)).toEqual(['S', 'QB']);
    });

    it('orders rounds numerically, not as text', () => {
        const { groups } = groupPlayers(
            [P('a', { round: 10 }), P('b', { round: 2 }), P('c', { round: 1 })],
            'round',
        );
        expect(groups.map(g => g.key)).toEqual(['1', '2', '10']);
    });

    it('sends a player with no value for THIS grouping to unmatched', () => {
        const players = [P('Known'), P('NoSchool', { school: '' })];

        expect(groupPlayers(players, 'school').unmatched.map(p => p.name)).toEqual(['NoSchool']);
        // He has a position, so grouping by position leaves nobody out.
        expect(groupPlayers(players, 'position').unmatched).toEqual([]);
    });

    it('treats an unranked player as unmatched by round, not as round 0', () => {
        const { groups, unmatched } = groupPlayers([P('x', { round: null })], 'round');
        expect(groups).toEqual([]);
        expect(unmatched.map(p => p.name)).toEqual(['x']);
    });

    it('keeps rank order inside a group', () => {
        const { groups } = groupPlayers([
            P('first', { overallRank: 3 }), P('second', { overallRank: 9 }),
        ], 'position');
        expect(groups[0].players.map(p => p.name)).toEqual(['first', 'second']);
    });

    it('names what a player is missing, so the gap can be fixed', () => {
        expect(missingFor(P('ok'))).toEqual([]);
        expect(missingFor(P('bad', { school: '', round: null, position: '' })))
            .toEqual(['school', 'rank', 'position']);
    });
});
