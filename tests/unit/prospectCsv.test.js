import { describe, it, expect } from 'vitest';
import { parseProspectCSV, CSV_COLUMNS, CSV_TEMPLATE } from '../../src/utils/prospects';

/**
 * The one way into a board. "+ Add Players" takes this file, and it has to
 * carry the evaluation — a ranking without what was said about the players is
 * half the work.
 */
describe('the Add Players CSV', () => {
    it('has an evaluation column, and the template hands it to you', () => {
        expect(CSV_COLUMNS).toContain('evaluation');
        expect(CSV_TEMPLATE.split('\n')[0]).toContain('evaluation');
    });

    it('reads remarks out of the evaluation cell, split by kind', () => {
        const csv = [
            CSV_COLUMNS.join(','),
            '"Fernando Mendoza",QB,Indiana,like,1,1,,,,"Remarks:',
            '+ Elite arm talent',
            '- Footwork under pressure',
            '• Two-year starter"',
        ].join('\n');

        const [row] = parseProspectCSV(csv);
        expect(row).toMatchObject({ name: 'Fernando Mendoza', position: 'QB', school: 'Indiana' });
        expect(row.strengths).toEqual(['Elite arm talent']);
        expect(row.weaknesses).toEqual(['Footwork under pressure']);
        expect(row.notes).toEqual(['Two-year starter']);
    });

    it('survives the two things that break a naive split', () => {
        // A multi-line quoted cell and a comma inside a name. Splitting on ","
        // and "\n" turned both into gibberish.
        const csv = [
            CSV_COLUMNS.join(','),
            '"Smith, Jr., Bob",RB,State,,2,1,,,,"Remarks:',
            '+ Contact balance"',
        ].join('\n');

        const [row] = parseProspectCSV(csv);
        expect(row.name).toBe('Smith, Jr., Bob');
        expect(row.strengths).toEqual(['Contact balance']);
    });

    it('takes a bare list with no evaluations at all', () => {
        const rows = parseProspectCSV('name,position,school\nCaleb Downs,S,Ohio State');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Caleb Downs', position: 'S' });
        expect(rows[0].strengths).toEqual([]);
    });

    it('ignores the comment lines the template ships with', () => {
        expect(parseProspectCSV(CSV_TEMPLATE)).toEqual([]);
    });
});
