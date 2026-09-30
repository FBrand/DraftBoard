import { describe, it, expect, beforeEach, vi } from 'vitest';
import { seedApp } from './seedForTests';
import { repository } from '../../src/data/repository';
import { allBoards, currentSeason } from '../../src/utils/boardRegistry';
import { openBoardEntries } from '../../src/data/boardEntries';
import { openDepthCharts } from '../../src/data/depthChartStore';
import { openProspects } from '../../src/data/prospectStore';
import { openStages } from '../../src/data/stageStore';

/**
 * What a cold load reads, counted.
 *
 * Firestore bills per DOCUMENT, and the free tier gives 50,000 reads a day. The
 * audit's figure for a cold load was ~1,484 documents, which works out at about
 * 33 loads a day for the whole operation — three analysts and every viewer
 * together. Nobody has re-counted it since, and several things have changed since
 * they did: charts gained a scope, prospects became three collections, and the
 * lead means followers subscribe where they used to poll.
 *
 * So this counts collection opens on a boot path, and reports them. It asserts
 * only the shape of the answer — which collections a boot touches at all — because
 * a document count depends on how much data is in the project, and the useful
 * output is the list to argue with.
 */
let opened;

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    opened = [];
    await seedApp();
});

describe('a cold load', () => {
    it('names every collection it opens, for the read budget to be argued with', async () => {
        const ready = vi.spyOn(repository, 'ready');
        ready.mockImplementation((collection) => {
            opened.push(collection);
            return Promise.resolve({});
        });

        const season = currentSeason()?.id;
        const boards = allBoards().map(b => b.id);

        // The same opens useBoardRankings does on a boot, minus the rankings
        // files, which are static assets rather than store reads.
        await Promise.all([
            openBoardEntries(boards),
            openDepthCharts(season),
            openProspects(season),
            openStages(season),
        ]);

        const families = {};
        opened.forEach((path) => {
            const family = path.split('/')[0];
            families[family] = (families[family] ?? 0) + 1;
        });

        console.log([
            '',
            `  collections opened: ${opened.length}  (${boards.length} boards, 1 season)`,
            ...Object.entries(families)
                .sort(([, a], [, b]) => b - a)
                .map(([k, v]) => `    ${k.padEnd(12)} ${v}`),
            '',
        ].join('\n'));

        ready.mockRestore();

        // One per board, not one per board per season: opening a board must not
        // walk the others.
        expect(opened.filter(p => p.startsWith('boards/'))).toHaveLength(boards.length);

        // The charts open MINE and OFFICIAL for both stages, rows and bands
        // each — eight — plus the legacy unscoped pair per stage on a local
        // store. That is the price of the scope, and it is worth seeing written
        // down rather than discovered on a bill.
        const charts = opened.filter(p => p.includes('/charts/'));
        expect(charts.length).toBeGreaterThanOrEqual(8);

        // NONE, and that is the migration showing up. The three prospect
        // collections moved onto the layered store, so they open through
        // `store.ready` and never touch the repository — which is what this spy
        // counts. A collection appearing on both sides would mean two caches
        // over one backend.
        expect(opened.filter(p => p.includes('prospect')).length).toBe(0);

        // The whole boot through the REPOSITORY: 16 collections for three boards
        // and one season. It was 19 before the prospect collections moved to the
        // layered store, and 8 before the chart scope and the prospect split.
        // Four of those are the LEGACY unscoped chart paths, read only on a local
        // store — the seeder writes official, so a shared project cannot have
        // them — leaving 12 on Firestore.
        //
        // Documents are what Firestore bills, not collections; see
        // readBudgetDocuments.test.js for that number. This counts the seam.
        expect(opened).toHaveLength(15);
    });
});
