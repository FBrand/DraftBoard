import { describe, it, expect } from 'vitest';
import { reconcileDraft } from '../../src/utils/draftReconcile';

/**
 * The two joins a draft reconciliation actually needs, pure and in
 * isolation — see the function's own comment in useDraftState.js for why
 * `pool` must already carry a resolved registry id on every player it has
 * one for, and why that is what makes re-running this per live pick safe
 * (see draftReconcile.js's own header comment).
 *
 * Team is TEAM_CONFIG.abbreviation ("KC") — getSessionTeam() falls back to
 * it with no localStorage present, which is this test environment.
 */
const POOL = [
    { id: 'p_mendoza', name: 'Fernando Mendoza', position: 'QB' },
    { id: 'p_reese', name: 'Arvell Reese', position: 'EDGE' },
    { name: 'Some Sleeper', position: 'WR' }, // never drafted, no id needed
];

describe('reconcileDraft', () => {
    it('joins a fully id-resolved pick by id, on both sides', () => {
        const savedDrafted = [
            { playerId: 'p_mendoza', name: 'Fernando Mendoza', pickNumber: 1, team: 'IND' },
        ];
        const { players, draftedPlayers } = reconcileDraft(POOL, savedDrafted);

        const mendoza = players.find(p => p.id === 'p_mendoza');
        expect(mendoza.drafted).toBe(true);
        expect(mendoza.pickNumber).toBe(1);
        expect(mendoza.draftedByUs).toBe(false);

        expect(draftedPlayers).toHaveLength(1);
        expect(draftedPlayers[0].playerId).toBe('p_mendoza');
        expect(draftedPlayers[0].position).toBe('QB'); // enriched from the pool
    });

    it('marks the drafting club as ours by comparison, not storage', () => {
        const savedDrafted = [
            { playerId: 'p_reese', name: 'Arvell Reese', pickNumber: 5, team: 'KC' },
        ];
        const { players, draftedPlayers } = reconcileDraft(POOL, savedDrafted);
        expect(players.find(p => p.id === 'p_reese').draftedByUs).toBe(true);
        expect(draftedPlayers[0].draftedByUs).toBe(true);
    });

    it('falls back to a qualified name match when a saved pick has no id', () => {
        // The legacy/imported-CSV case: a pick with a name but no playerId.
        const savedDrafted = [
            { name: 'Fernando Mendoza', position: 'QB', pickNumber: 1, team: 'IND' },
        ];
        const { players, draftedPlayers } = reconcileDraft(POOL, savedDrafted);
        expect(players.find(p => p.id === 'p_mendoza').drafted).toBe(true);
        // The reconciled drafted-side entry picks up the pool's id even
        // though the saved record itself had none.
        expect(draftedPlayers[0].playerId).toBe('p_mendoza');
    });

    it('a pick nobody in the pool has ever heard of stays as-is, marked by its own persisted flag', () => {
        const savedDrafted = [
            { playerId: 'p_stranger', name: 'Nobody Knows Him', pickNumber: 99, team: null, draftedByUs: true },
        ];
        const { players, draftedPlayers } = reconcileDraft(POOL, savedDrafted);
        // No pool player should have been mismatched onto this pick.
        expect(players.every(p => p.pickNumber !== 99)).toBe(true);
        expect(draftedPlayers).toHaveLength(1);
        expect(draftedPlayers[0].name).toBe('Nobody Knows Him');
        // No team on the pick — falls back to the persisted draftedByUs.
        expect(draftedPlayers[0].draftedByUs).toBe(true);
    });

    it('an undrafted pool player is untouched', () => {
        const { players } = reconcileDraft(POOL, []);
        const sleeper = players.find(p => p.name === 'Some Sleeper');
        expect(sleeper.drafted).toBeUndefined();
    });

    it('produces the same result whichever direction a caller might have picked, for a fully id-resolved pool', () => {
        // Regression guard for the optimization itself: this is not about
        // testing performance, it is about proving the join-direction change
        // didn't change the OUTCOME, only the cost. Build the same saved
        // picks against the same pool and confirm the join hits by id
        // regardless of list sizes on either side.
        const bigPool = [...POOL, ...Array.from({ length: 50 }, (_, i) => ({
            id: `p_extra_${i}`, name: `Extra Player ${i}`, position: 'RB',
        }))];
        const savedDrafted = [
            { playerId: 'p_reese', name: 'Arvell Reese', pickNumber: 3, team: 'KC' },
        ];
        const { players } = reconcileDraft(bigPool, savedDrafted);
        expect(players.filter(p => p.drafted)).toHaveLength(1);
        expect(players.find(p => p.drafted).id).toBe('p_reese');
    });
});
