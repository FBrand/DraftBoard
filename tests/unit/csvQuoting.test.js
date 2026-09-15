import { describe, it, expect } from 'vitest';
import { parseCsvLine, csvField } from '../../src/utils/csvUtils';

/**
 * The quoting every import and export in this app stands on.
 *
 * Added to fix a real corruption: Ourlads writes names as "Last, First", and a
 * plain `split(',')` turned one player into two fields on export and two
 * players on the way back in. Both stores use these now, and the scouting
 * export puts free text — remarks — through them, where a comma is not an edge
 * case but the normal shape of a sentence.
 *
 * Tested directly, rather than only through a round trip, because a round trip
 * that is wrong in both directions passes.
 */
describe('reading a line', () => {
    it('splits plain fields', () => {
        expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('keeps a comma inside quotes, which is the bug it was written for', () => {
        expect(parseCsvLine('"Smith, Trey",WR')).toEqual(['Smith, Trey', 'WR']);
    });

    it('unescapes a doubled quote', () => {
        expect(parseCsvLine('"he said ""no""",x')).toEqual(['he said "no"', 'x']);
    });

    it('keeps empty fields, including trailing ones', () => {
        expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
        expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
        expect(parseCsvLine('')).toEqual(['']);
    });

    it('reads a quoted empty field', () => {
        expect(parseCsvLine('a,"",c')).toEqual(['a', '', 'c']);
    });

    it('does not mind a quote that opens mid-field', () => {
        // Not valid RFC-4180, but hand-edited files exist and must not explode.
        expect(() => parseCsvLine('a,b"c,d')).not.toThrow();
    });
});

describe('writing a field', () => {
    it('leaves an ordinary value alone', () => {
        expect(csvField('Mahomes')).toBe('Mahomes');
    });

    it('quotes a comma', () => {
        expect(csvField('Smith, Trey')).toBe('"Smith, Trey"');
    });

    it('quotes and doubles an embedded quote', () => {
        expect(csvField('he said "no"')).toBe('"he said ""no"""');
    });

    it('quotes a newline', () => {
        expect(csvField('two\nlines')).toBe('"two\nlines"');
    });

    it('writes null and undefined as empty, not as the words', () => {
        expect(csvField(null)).toBe('');
        expect(csvField(undefined)).toBe('');
    });
});

describe('a field survives the round trip', () => {
    const cases = [
        'Mahomes',
        'Smith, Trey',
        'he said "no"',
        'quotes "and, commas"',
        '',
        '   spaced   ',
        'JSON-ish ["a","b"]',
        "Ja'Marr Chase Jr.",
    ];

    it.each(cases)('%j', (value) => {
        expect(parseCsvLine(csvField(value))).toEqual([value]);
    });

    it('survives beside its neighbours, not only alone', () => {
        const row = ['1.1', 'Smith, Trey', 'WR', 'he said "no"', ''];
        expect(parseCsvLine(row.map(csvField).join(','))).toEqual(row);
    });

    it('carries a remark that is an ordinary sentence', () => {
        // What the scouting export actually puts through here.
        const remark = 'Sticky in man coverage, but grabby downfield — watch the hands.';
        expect(parseCsvLine(csvField(remark))).toEqual([remark]);
    });
});
