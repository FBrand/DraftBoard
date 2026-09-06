import { describe, it, expect } from 'vitest';
import {
    BOARD_CSV_COLUMNS, formatRemarksCell, parseRemarksCell,
    exportBoardCSV, parseBoardCSV,
} from '../../src/utils/boardCsv';

const remarks = [
    { kind: 'strength', text: 'Elite arm talent' },
    { kind: 'weakness', text: 'Footwork under pressure' },
    { kind: 'note', text: 'Two-year starter' },
];

describe('remarks cell', () => {
    it('leads with Remarks: so a spreadsheet does not read + or - as a formula', () => {
        expect(formatRemarksCell(remarks).split('\n')[0]).toBe('Remarks:');
    });

    it('is empty rather than a bare header when there are no remarks', () => {
        expect(formatRemarksCell([])).toBe('');
        expect(formatRemarksCell(null)).toBe('');
    });

    it('round-trips every kind', () => {
        expect(parseRemarksCell(formatRemarksCell(remarks))).toEqual(remarks);
    });

    it('accepts the dashes a word processor produces, not just the typed one', () => {
        ['-', '−', '–', '—'].forEach(dash => {
            expect(parseRemarksCell(`${dash} Hands`)).toEqual([{ kind: 'weakness', text: 'Hands' }]);
        });
    });

    it('accepts the note markers a person is likely to reach for', () => {
        ['•', '*', '.', 'o'].forEach(mark => {
            expect(parseRemarksCell(`${mark} Team captain`)).toEqual([{ kind: 'note', text: 'Team captain' }]);
        });
    });

    it('keeps an unmarked line as a note rather than dropping what was typed', () => {
        expect(parseRemarksCell('Played through a shoulder injury'))
            .toEqual([{ kind: 'note', text: 'Played through a shoulder injury' }]);
    });

    it('reads a cell written without the header', () => {
        expect(parseRemarksCell('+ Burst\n- Anchor')).toEqual([
            { kind: 'strength', text: 'Burst' },
            { kind: 'weakness', text: 'Anchor' },
        ]);
    });
});

describe('board CSV', () => {
    const players = [
        { name: 'Fernando Mendoza', position: 'QB', school: 'Indiana', round: 1, tier: 1 },
        { name: 'David Bailey', position: 'EDGE', school: 'Texas Tech', round: 1, tier: 2 },
    ];

    it('round-trips placement and identity through a multi-line quoted cell', () => {
        const csv = exportBoardCSV(players, { remarksFor: p => (p.name === 'Fernando Mendoza' ? remarks : []) });
        const back = parseBoardCSV(csv);

        expect(back).toHaveLength(2);
        expect(back[0]).toMatchObject({
            name: 'Fernando Mendoza', position: 'QB', school: 'Indiana', round: 1, tier: 1,
        });
        expect(back[0].remarks).toEqual(remarks);
        expect(back[1].remarks).toEqual([]);
    });

    it('takes column order from the header, so a reordered spreadsheet still imports', () => {
        const rows = parseBoardCSV('name,school,position\nCaleb Downs,Ohio State,S');
        expect(rows[0]).toMatchObject({ name: 'Caleb Downs', school: 'Ohio State', position: 'S' });
    });

    it('assumes the documented order when there is no header', () => {
        const rows = parseBoardCSV('2,3,Jermod McCoy,CB,Tennessee,,');
        expect(rows[0]).toMatchObject({ round: 2, tier: 3, name: 'Jermod McCoy', position: 'CB' });
    });

    it('skips rows with no name instead of importing a blank player', () => {
        expect(parseBoardCSV(`${BOARD_CSV_COLUMNS.join(',')}\n1,1,,QB,,,`)).toHaveLength(0);
    });

    it('survives a name containing a comma', () => {
        const csv = exportBoardCSV([{ name: 'Smith, Jr., Bob', position: 'RB', round: 3, tier: 1 }]);
        expect(parseBoardCSV(csv)[0].name).toBe('Smith, Jr., Bob');
    });
});
