import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRankings } from '../../src/utils/dataParser';
import { rankBoard, basePosition } from '../../src/utils/boardRanking';
import { buildNameIndex, findMatchingIndex } from '../../src/utils/nameMatcher';

/**
 * One player, labelled differently by different analysts.
 *
 * Rueben Bain Jr is `DL.3T` on the consensus board and `EDGE` on both personal
 * boards. That is normal — analysts disagree about what a man plays, and it
 * says nothing about whether he is the same man.
 *
 * The union join already knew this (useBoardRankings.joinKeyFor). The player
 * card did not: it looked him up passing the whole player as a qualifier, the
 * position disagreed, the lookup missed, and the card fell back to the raw
 * player — who carries no derived ranks. So a player every board had ranked
 * showed "???" for position rank.
 */
const load = (f) => parseRankings(readFileSync(`public/${f}`, 'utf8')).filter(p => p?.name);
const BAIN = /^Rueben Bain/;

describe('a player labelled differently on different boards', () => {
    it('really is labelled differently — otherwise this test proves nothing', () => {
        const positions = ['rankings_consensus.csv', 'rankings_dan.csv', 'rankings_ryan.csv']
            .map(f => basePosition(load(f).find(p => BAIN.test(p.name))?.position));

        expect(new Set(positions).size).toBeGreaterThan(1);
    });

    it('is ranked on every board that lists him', () => {
        for (const f of ['rankings_consensus.csv', 'rankings_dan.csv', 'rankings_ryan.csv']) {
            const ranked = rankBoard(load(f), () => null).find(p => BAIN.test(p.name));
            expect(ranked?.overallRank, f).not.toBeNull();
            expect(ranked?.positionRank, f).not.toBeNull();
        }
    });

    it('is found on a board that calls him something else, when matched by name', () => {
        const consensus = rankBoard(load('rankings_consensus.csv'), () => null);
        const index = buildNameIndex(consensus);

        const found = findMatchingIndex('Rueben Bain Jr', index);
        expect(found).not.toBe(-1);
        expect(consensus[found].positionRank).not.toBeNull();
    });

    it('is NOT found when position is used to qualify him — the bug', () => {
        const consensus = rankBoard(load('rankings_consensus.csv'), () => null);
        const index = buildNameIndex(consensus);

        // Documents why the card must not pass a position across boards.
        expect(findMatchingIndex('Rueben Bain Jr', index, { position: 'EDGE' })).toBe(-1);
    });
});
