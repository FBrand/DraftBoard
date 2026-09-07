import { describe, it, expect } from 'vitest';
import { exportBoardCSV, BOARD_CSV_COLUMNS } from '../../src/utils/boardCsv';
import { parseProspectCSV } from '../../src/utils/prospects';
import { parseRankings } from '../../src/utils/dataParser';

/**
 * A board out and back in, with all three kinds of remark.
 *
 * These are three separate modules — the exporter, the "+ Add Players"
 * importer, and the seed-file reader — and the file is the only thing they
 * share. Testing them one at a time proved each could read its own idea of the
 * format; the round trip is what proves they agree. It already caught one
 * disagreement: the export wrote the tag as "★" while the reader only knew
 * "like", so a favourite died on the way back in.
 */
const REMARKS = [
    { kind: 'strength', text: 'Elite arm talent' },
    { kind: 'strength', text: 'Layers the ball outside the numbers' },
    { kind: 'weakness', text: 'Footwork under pressure' },
    { kind: 'note', text: 'Two-year starter' },
    { kind: 'note', text: 'Team captain' },
];

const PLAYERS = [
    { name: 'Fernando Mendoza', position: 'QB', school: 'Indiana', round: 1, tier: 1 },
    { name: 'Smith, Jr., Bob', position: 'RB', school: 'State', round: 2, tier: 3 },
];

const csv = () => exportBoardCSV(PLAYERS, {
    entryFor: (p) => (p.name === 'Fernando Mendoza' ? { tag: 'like', withinGroup: 100 } : null),
    remarksFor: (p) => (p.name === 'Fernando Mendoza' ? REMARKS : []),
    matrixFor: (p) => (p.name === 'Fernando Mendoza' ? { total: 88, position: 92 } : {}),
});

describe('a board exported and imported again', () => {
    it('writes the three markers under a Remarks: header', () => {
        const text = csv();
        expect(text.split('\n')[0]).toBe(BOARD_CSV_COLUMNS.join(','));
        expect(text).toContain('Remarks:');
        expect(text).toContain('+ Elite arm talent');
        expect(text).toContain('- Footwork under pressure');
        expect(text).toContain('• Two-year starter');
    });

    it('comes back through Add Players with every remark on the right pile', () => {
        const rows = parseProspectCSV(csv());
        const mendoza = rows.find(r => r.name === 'Fernando Mendoza');

        expect(mendoza.strengths).toEqual(['Elite arm talent', 'Layers the ball outside the numbers']);
        expect(mendoza.weaknesses).toEqual(['Footwork under pressure']);
        expect(mendoza.notes).toEqual(['Two-year starter', 'Team captain']);
    });

    it('carries placement, school, tag and matrix through with them', () => {
        const mendoza = parseProspectCSV(csv()).find(r => r.name === 'Fernando Mendoza');
        expect(mendoza).toMatchObject({
            position: 'QB', school: 'Indiana', round: '1', tier: '1',
            matrixTotal: '88', matrixPosition: '92',
        });
        expect(mendoza.tag).toBeTruthy();
    });

    it('is also readable as a seed file, remarks and all', () => {
        // The same file the app boots from — one format, both directions.
        const seeded = parseRankings(csv());
        const mendoza = seeded.find(p => p.name === 'Fernando Mendoza');

        expect(mendoza).toMatchObject({ position: 'QB', school: 'Indiana', round: 1, tier: 1 });
        expect(mendoza.remarks).toEqual(REMARKS);
        expect(mendoza.isFavorite).toBe(true);
    });

    it('keeps a player whose NAME contains commas intact', () => {
        const rows = parseProspectCSV(csv());
        expect(rows.map(r => r.name)).toContain('Smith, Jr., Bob');
    });

    it('leaves a player with no remarks with three empty piles, not one blank note', () => {
        const bob = parseProspectCSV(csv()).find(r => r.name.startsWith('Smith'));
        expect(bob.strengths).toEqual([]);
        expect(bob.weaknesses).toEqual([]);
        expect(bob.notes).toEqual([]);
    });
});
