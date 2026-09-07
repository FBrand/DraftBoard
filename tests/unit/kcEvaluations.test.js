
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProspectCSV } from '../../src/utils/prospects';
import { parseRankings } from '../../src/utils/dataParser';

const text = readFileSync('public/evaluations_kc_2026.csv', 'utf8');

describe('the Chiefs 2026 example evaluations', () => {
    it('reads back through Add Players with every remark on the right pile', () => {
        const rows = parseProspectCSV(text);
        expect(rows).toHaveLength(7);
        rows.forEach(r => {
            const total = r.strengths.length + r.weaknesses.length + r.notes.length;
            expect(total, r.name).toBeGreaterThanOrEqual(10);
            expect(r.strengths.length, r.name).toBeGreaterThan(0);
            expect(r.weaknesses.length, r.name).toBeGreaterThan(0);
            expect(r.notes.length, r.name).toBeGreaterThan(0);
            expect(r.school, r.name).toBeTruthy();
        });
        const delane = rows.find(r => r.name === 'Mansoor Delane');
        expect(delane.strengths[0]).toMatch(/Sticky man-cover corner/);
        expect(delane.weaknesses[0]).toMatch(/eyes wander/);
        expect(delane.notes[0]).toMatch(/grade 8.2/);
    });

    it('is also a valid seed file', () => {
        const seeded = parseRankings(text);
        expect(seeded).toHaveLength(7);
        expect(seeded.find(p => p.name === 'Peter Woods')).toMatchObject({ position: 'DL', school: 'Clemson', round: 1, tier: 2 });
        expect(seeded.find(p => p.name === 'Mansoor Delane').isFavorite).toBe(true);
    });
});
