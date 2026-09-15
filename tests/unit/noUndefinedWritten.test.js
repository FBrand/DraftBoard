import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { repository } from '../../src/data/repository';
import { parseCSV } from '../../src/utils/rosterState';
import { writeChart, rowsPath } from '../../src/data/depthChartStore';

/**
 * Nothing we store may contain `undefined`.
 *
 * JSON.stringify drops an undefined value silently, so localStorage has always
 * accepted a depth-chart row whose `slots53` or `label` happened to be
 * undefined, and nothing had to care. It is not a harmless difference:
 *
 *   - `DepthChartGrid` does `Math.max(slots53, 1)`, and Math.max(undefined, 1)
 *     is NaN — `Array.from({length: NaN})` is empty, so the row would render
 *     with no 53-man slots at all and its +/- controls would read NaN.
 *   - A document store refuses the value outright. Firestore rejects the WHOLE
 *     batch with invalid-argument, and the repository correctly calls that
 *     permanent and stops — so one malformed row took down every unrelated
 *     write with it.
 *
 * So this walks what `writeChart` actually produces from the real shipped
 * roster, rather than trusting that the fields are always filled in.
 */
const SEASON = 's_test';
const STAGE = 'rosterState';

const undefinedPaths = (value, path = '') => {
    if (value === undefined) return [path || '(root)'];
    if (value === null || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
        return value.flatMap((v, i) => undefinedPaths(v, `${path}[${i}]`));
    }
    return Object.entries(value).flatMap(([k, v]) => undefinedPaths(v, path ? `${path}.${k}` : k));
};

beforeEach(async () => {
    repository.invalidate();
    await repository.ready(rowsPath(STAGE, SEASON));
});

describe('what writeChart produces', () => {
    it('has no undefined anywhere, for the shipped pre-draft roster', async () => {
        const state = parseCSV(readFileSync('public/roster_predraft.csv', 'utf8'));
        writeChart(STAGE, SEASON, state);

        const docs = repository.docs(rowsPath(STAGE, SEASON)) ?? {};
        expect(Object.keys(docs).length).toBeGreaterThan(0);

        const bad = Object.entries(docs)
            .flatMap(([id, doc]) => undefinedPaths(doc).map(where => `${id}.${where}`));
        expect(bad).toEqual([]);
    });

    it('has no undefined for the full 91-man roster either', async () => {
        const state = parseCSV(readFileSync('public/roster.csv', 'utf8'));
        writeChart(STAGE, SEASON, state);

        const docs = repository.docs(rowsPath(STAGE, SEASON)) ?? {};
        const bad = Object.entries(docs)
            .flatMap(([id, doc]) => undefinedPaths(doc).map(where => `${id}.${where}`));
        expect(bad).toEqual([]);
    });

    it('has no undefined for a chart whose rows are not in positionConfig', async () => {
        // Specialists live in depthChart with no chip of their own, and take
        // the other branch of writeChart.
        const state = parseCSV(readFileSync('public/roster.csv', 'utf8'));
        const stray = { ...state, positionConfig: { offense: [], defense: [] } };
        writeChart(STAGE, SEASON, stray);

        const docs = repository.docs(rowsPath(STAGE, SEASON)) ?? {};
        const bad = Object.entries(docs)
            .flatMap(([id, doc]) => undefinedPaths(doc).map(where => `${id}.${where}`));
        expect(bad).toEqual([]);
    });
});
