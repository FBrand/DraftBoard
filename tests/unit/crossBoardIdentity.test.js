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

/**
 * A depth-chart row label is an ALIGNMENT, not a position.
 *
 * LT, WR.Z, DL.3T are where a player lines up. OT, WR, DL are what he plays.
 * Qualifying a registry lookup by the alignment therefore matches nobody, and
 * the caller — having asked for a player and been told there is none — makes
 * a second one.
 *
 * This is the third time this shape of bug has landed: a player card with no
 * position rank, a veteran whose remarks vanished, and signing Diego Pounds
 * at LT when the registry already held him as an OT out of Ole Miss drafted
 * in 2026. Each time the screen looked right, because whatever was displaying
 * him resolved by name and found the original.
 */
describe('looking a player up by the row he is standing in', () => {
    const registry = [
        { id: 'p1', name: 'Diego Pounds', position: 'OT', school: 'Ole Miss' },
    ];

    it('does not find him when qualified by the alignment — this is the bug', () => {
        const index = buildNameIndex(registry);
        expect(findMatchingIndex('Diego Pounds', index, { position: 'LT' })).toBe(-1);
    });

    it('finds him by name alone, which is what the caller should ask first', () => {
        const index = buildNameIndex(registry);
        expect(findMatchingIndex('Diego Pounds', index)).toBe(0);
    });

    it('still tells two men of one name apart when it is asked to', () => {
        // The qualified lookup is not wrong, it is just the wrong first
        // question. It remains the fallback, and this is why.
        const two = [
            { id: 'p1', name: 'Mike Green', position: 'EDGE' },
            { id: 'p2', name: 'Mike Green', position: 'WR' },
        ];
        const index = buildNameIndex(two);
        expect(findMatchingIndex('Mike Green', index, { position: 'WR' })).toBe(1);
        expect(findMatchingIndex('Mike Green', index, { position: 'EDGE' })).toBe(0);
    });
});
