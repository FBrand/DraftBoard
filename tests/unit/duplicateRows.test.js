import { describe, it, expect } from 'vitest';
import { duplicatesIn } from '../../src/hooks/useBoardRankings';

/**
 * A file that rates one man twice.
 *
 * rankings_dan.csv had Jakobe Thomas at 3.4 and again at 5.3. The board showed
 * him once and said nothing, so one of Dan's two opinions was discarded by
 * line order — and the two rules involved disagreed with each other: the
 * shared pool kept the first row, the board's own placement kept the last.
 *
 * Not to be confused with the legitimate case one function above: a name at
 * two POSITIONS is an analyst listing two different people, and the app makes
 * position part of the key precisely so that works.
 */
const row = (name, position, round, tier) => ({ name, position, round, tier });

describe('spotting a file that contradicts itself', () => {
    it('finds the same man rated twice', () => {
        const out = duplicatesIn({
            dan: [row('Jakobe Thomas', 'S', 3, 4), row('Jakobe Thomas', 'S', 5, 3)],
        });

        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ boardId: 'dan', name: 'Jakobe Thomas', count: 2 });
    });

    it('says what the rows disagree about, not merely that they do', () => {
        const [issue] = duplicatesIn({
            dan: [row('Jakobe Thomas', 'S', 3, 4), row('Jakobe Thomas', 'S', 5, 3)],
        });
        expect(issue.placements).toEqual(['3.4', '5.3']);
    });

    it('leaves two different men sharing a name alone', () => {
        // The legitimate case. Mike Green the edge rusher and Mike Green the
        // receiver are two people, and the app already keys them apart.
        expect(duplicatesIn({
            dan: [row('Mike Green', 'EDGE', 2, 1), row('Mike Green', 'WR', 4, 2)],
        })).toEqual([]);
    });

    it('reports an unranked row as unranked rather than as a placement', () => {
        const [issue] = duplicatesIn({
            dan: [row('Somebody', 'QB', null, null), row('Somebody', 'QB', 1, 1)],
        });
        expect(issue.placements).toEqual(['unranked', '1.1']);
    });

    it('counts three rows as three', () => {
        const [issue] = duplicatesIn({
            dan: [row('Somebody', 'QB', 1, 1), row('Somebody', 'QB', 2, 1), row('Somebody', 'QB', 3, 1)],
        });
        expect(issue.count).toBe(3);
    });

    it('keeps each board’s problems to that board', () => {
        const out = duplicatesIn({
            dan: [row('A Man', 'QB', 1, 1), row('A Man', 'QB', 2, 1)],
            ryan: [row('A Man', 'QB', 1, 1)],
        });
        expect(out.map(i => i.boardId)).toEqual(['dan']);
    });

    it('says nothing about a clean set of files', () => {
        expect(duplicatesIn({
            dan: [row('One', 'QB', 1, 1), row('Two', 'RB', 1, 2)],
            ryan: [row('One', 'QB', 2, 1)],
        })).toEqual([]);
        expect(duplicatesIn({})).toEqual([]);
        expect(duplicatesIn(null)).toEqual([]);
    });
});
