import { describe, it, expect } from 'vitest';
import {
    BOARD_CSV_COLUMNS, formatRemarksCell, parseRemarksCell,
    exportBoardCSV, parseBoardCSV,
} from '../../src/utils/boardCsv';
import { parseRankings } from '../../src/utils/dataParser';

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
        const rows = parseBoardCSV('Jermod McCoy,CB,Tennessee,,2,3');
        expect(rows[0]).toMatchObject({ round: 2, tier: 3, name: 'Jermod McCoy', position: 'CB' });
    });

    it('skips rows with no name instead of importing a blank player', () => {
        expect(parseBoardCSV(`${BOARD_CSV_COLUMNS.join(',')}\n,QB,,,1,1`)).toHaveLength(0);
    });

    it('survives a name containing a comma', () => {
        const csv = exportBoardCSV([{ name: 'Smith, Jr., Bob', position: 'RB', round: 3, tier: 1 }]);
        expect(parseBoardCSV(csv)[0].name).toBe('Smith, Jr., Bob');
    });
});

/**
 * There is one board format now, not three. The seed file the app boots from
 * and the file you edit in a spreadsheet are the same file — so whatever the
 * board exports has to come back in through the front door.
 */
describe('one format, both directions', () => {
    const players = [
        { name: 'Fernando Mendoza', position: 'QB', school: 'Indiana', round: 1, tier: 1 },
        { name: 'Rueben Bain Jr', position: 'EDGE', school: 'Miami', round: 1, tier: 2 },
    ];

    it('an exported board is readable as a rankings file', () => {
        const csv = exportBoardCSV(players, {
            entryFor: () => ({ tag: 'like', withinGroup: 100 }),
            remarksFor: () => [{ kind: 'strength', text: 'Elite arm talent' }],
        });

        const seeded = parseRankings(csv);
        expect(seeded).toHaveLength(2);
        expect(seeded[0]).toMatchObject({
            name: 'Fernando Mendoza', position: 'QB', school: 'Indiana', round: 1, tier: 1,
        });
        // The star and the `like` tag are one mechanic.
        expect(seeded[0].isFavorite).toBe(true);
        expect(seeded[0].remarks[0]).toEqual({ kind: 'strength', text: 'Elite arm talent' });
    });

    it('still reads the shipped three-column files, blank groups and all', () => {
        const legacy = parseRankings([
            'group,name,position,favourite',
            '1,Fernando Mendoza,QB',
            ',Arvell Reese,EDGE,*',
            '2.1,Caleb Downs,S',
        ].join('\n'));

        expect(legacy).toHaveLength(3);
        expect(legacy[0]).toMatchObject({ name: 'Fernando Mendoza', round: 1 });
        // A blank group inherits the last one seen — that is what makes a
        // hand-typed file bearable.
        expect(legacy[1]).toMatchObject({ name: 'Arvell Reese', round: 1, isFavorite: true });
        expect(legacy[2]).toMatchObject({ name: 'Caleb Downs', round: 2, tier: 1 });
    });
});
