import { describe, it, expect, beforeEach } from 'vitest';
import { resolveBoardPlayers } from '../../src/utils/boardPlayers';

beforeEach(() => {
    globalThis.resetStorage();
});

const samplePlayer = (id, name, position, round, tier, overallRank, extra = {}) => ({
    id,
    name,
    position,
    school: 'State',
    round,
    tier,
    overallRank,
    positionRank: 1,
    drafted: false,
    ...extra,
});

describe('resolveBoardPlayers for draft board ranking', () => {
    const consensusPlayers = [
        samplePlayer('p1', 'Fernando Mendoza', 'QB', 1, 1, 1),
        samplePlayer('p2', 'Travis Hunter', 'CB', 1, 1, 2),
        samplePlayer('p3', 'Tetairoa McMillan', 'WR', 1, 2, 3),
        samplePlayer('p4', 'Cam Ward', 'QB', 2, 1, 4),
        samplePlayer('p5', 'Abdul Carter', 'EDGE', 2, 2, 5),
    ];

    it('leaves consensus players untouched when the board has a rankingsFile', () => {
        const board = { id: 'b_consensus', slug: 'consensus', rankingsFile: 'rankings_consensus.csv' };
        const result = resolveBoardPlayers(consensusPlayers, 'consensus', {
            getBoard: () => board,
            loadState: () => ({ entries: [] }),
        });

        expect(result).toBe(consensusPlayers);
    });

    it('correctly ranks 3 players placed on a new board and marks all others unranked', () => {
        const newBoard = { id: 'b_custom', slug: 'my-scouting-board', rankingsFile: null };
        const entries = [
            // Ranking Travis Hunter (CB) at Round 1, Tier 1
            { playerId: 'p2', name: 'Travis Hunter', position: 'CB', round: 1, tier: 1, withinGroup: 1 },
            // Ranking Cam Ward (QB) at Round 1, Tier 2
            { playerId: 'p4', name: 'Cam Ward', position: 'QB', round: 1, tier: 2, withinGroup: 1 },
            // Ranking Abdul Carter (EDGE) at Round 2, Tier 1
            { playerId: 'p5', name: 'Abdul Carter', position: 'EDGE', round: 2, tier: 1, withinGroup: 1 },
        ];

        const result = resolveBoardPlayers(consensusPlayers, 'my-scouting-board', {
            getBoard: () => newBoard,
            loadState: () => ({ entries }),
        });

        // 1. Check the 3 ranked players
        const hunter = result.find(p => p.id === 'p2');
        const ward = result.find(p => p.id === 'p4');
        const carter = result.find(p => p.id === 'p5');

        expect(hunter.round).toBe(1);
        expect(hunter.tier).toBe(1);
        expect(hunter.overallRank).toBe(1);
        expect(hunter.positionRank).toBe(1);

        expect(ward.round).toBe(1);
        expect(ward.tier).toBe(2);
        expect(ward.overallRank).toBe(2);
        expect(ward.positionRank).toBe(1);

        expect(carter.round).toBe(2);
        expect(carter.tier).toBe(1);
        expect(carter.overallRank).toBe(3);
        expect(carter.positionRank).toBe(1);

        // 2. Check the unranked players (Fernando Mendoza, Tetairoa McMillan)
        const mendoza = result.find(p => p.id === 'p1');
        const mcmillan = result.find(p => p.id === 'p3');

        expect(mendoza.round).toBeNull();
        expect(mendoza.tier).toBeNull();
        expect(mendoza.overallRank).toBeNull();
        expect(mendoza.positionRank).toBeNull();

        expect(mcmillan.round).toBeNull();
        expect(mcmillan.tier).toBeNull();
        expect(mcmillan.overallRank).toBeNull();
        expect(mcmillan.positionRank).toBeNull();

        // 3. Metadata preservation
        expect(hunter.school).toBe('State');
        expect(hunter.drafted).toBe(false);
    });

    it('marks all players unranked when a new board has no entries yet', () => {
        const emptyBoard = { id: 'b_empty', slug: 'empty-board', rankingsFile: null };
        const result = resolveBoardPlayers(consensusPlayers, 'empty-board', {
            getBoard: () => emptyBoard,
            loadState: () => ({ entries: [] }),
        });

        expect(result.length).toBe(consensusPlayers.length);
        result.forEach(p => {
            expect(p.round).toBeNull();
            expect(p.tier).toBeNull();
            expect(p.overallRank).toBeNull();
            expect(p.positionRank).toBeNull();
        });
    });

    it('respects withinGroup ordering within the same tier', () => {
        const newBoard = { id: 'b_custom', slug: 'custom-board', rankingsFile: null };
        const entries = [
            // Cam Ward with higher withinGroup -> should rank second within Tier 1.1
            { playerId: 'p4', name: 'Cam Ward', position: 'QB', round: 1, tier: 1, withinGroup: 2.0 },
            // Fernando Mendoza with lower withinGroup -> should rank first within Tier 1.1
            { playerId: 'p1', name: 'Fernando Mendoza', position: 'QB', round: 1, tier: 1, withinGroup: 1.0 },
        ];

        const result = resolveBoardPlayers(consensusPlayers, 'custom-board', {
            getBoard: () => newBoard,
            loadState: () => ({ entries }),
        });

        const mendoza = result.find(p => p.id === 'p1');
        const ward = result.find(p => p.id === 'p4');

        expect(mendoza.overallRank).toBe(1);
        expect(mendoza.positionRank).toBe(1);

        expect(ward.overallRank).toBe(2);
        expect(ward.positionRank).toBe(2);
    });

    it('matches entries by name fallback when playerId is absent', () => {
        const newBoard = { id: 'b_custom', slug: 'custom-board', rankingsFile: null };
        const entries = [
            { playerId: null, name: 'Travis Hunter', position: 'CB', round: 1, tier: 1 },
        ];

        const result = resolveBoardPlayers(consensusPlayers, 'custom-board', {
            getBoard: () => newBoard,
            loadState: () => ({ entries }),
        });

        const hunter = result.find(p => p.id === 'p2');
        expect(hunter.round).toBe(1);
        expect(hunter.tier).toBe(1);
        expect(hunter.overallRank).toBe(1);
    });
});
