import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { repository } from '../../src/data/repository';
import { openBoards, allBoards, viewedSeason } from '../../src/utils/boardRegistry';
import { openBoardEntries } from '../../src/data/boardEntries';
import { openDepthCharts } from '../../src/data/depthChartStore';
import { openProspects } from '../../src/data/prospectStore';
import { openStages } from '../../src/data/stageStore';
import { openSetup } from '../../src/utils/seasonInit';
import { openRegistry } from '../../src/utils/playerRegistry';
import { openDraft } from '../../src/data/draftStore';

/**
 * What a cold load costs in DOCUMENTS, which is what Firestore bills.
 *
 * `readBudget.test.js` counts collections opened, and the audit was right that
 * this is the wrong quantity: the free tier gives 50,000 document reads a day,
 * and a collection read costs one per document returned. Nineteen collections
 * says nothing about whether that is thirty documents or two thousand.
 *
 * So this seeds the store from the real snapshot — the same 1777 documents the
 * seeder produces — and counts what the app asks for on a boot. The number is
 * reported, because the useful output is the figure to argue with; the assertion
 * is only that the shape has not changed by an order of magnitude.
 *
 * The audit's standing figure for comparison is ~1,484 documents per cold load,
 * which it put at about 33 loads a day for the whole operation.
 */
const snapshot = JSON.parse(readFileSync('public/seed-snapshot.json', 'utf8'));

let reads;

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();

    // The store as the seeder leaves it.
    const adapter = repository.adapter;
    for (const [collection, docs] of Object.entries(snapshot.collections)) {
        await adapter.commit(collection, Object.entries(docs).map(([id, doc]) => ({ id, doc })));
    }
    repository.invalidate();

    // Every load, counted by the documents it returns.
    reads = [];
    const realLoad = adapter.load.bind(adapter);
    adapter.load = async (collection) => {
        const docs = await realLoad(collection);
        reads.push({ collection, documents: Object.keys(docs ?? {}).length });
        return docs;
    };
});

describe('a cold load, in documents', () => {
    it('is counted and reported', async () => {
        await openBoards();
        const season = viewedSeason()?.id ?? null;
        const boards = allBoards().map(b => b.id);

        await Promise.all([
            openRegistry(),
            openDraft(),
            openBoardEntries(boards),
            openDepthCharts(season),
            openProspects(season),
            openStages(season),
            openSetup(season),
        ]);

        const total = reads.reduce((n, r) => n + r.documents, 0);
        const empty = reads.filter(r => r.documents === 0).length;

        console.log([
            '',
            `  collections read   ${reads.length}  (${empty} of them empty)`,
            `  DOCUMENTS read     ${total}`,
            '  the expensive ones:',
            ...reads.filter(r => r.documents > 0)
                .sort((a, b) => b.documents - a.documents)
                .slice(0, 8)
                .map(r => `    ${String(r.documents).padStart(4)}  ${r.collection}`),
            '',
        ].join('\n'));

        // Every board's entries are opened, and they are the bulk of it: three
        // boards at 328 each. Opening one board should cost one board.
        const entries = reads.filter(r => r.collection.includes('/entries'));
        expect(entries).toHaveLength(boards.length);

        // The registry is read WHOLE — 720 players for a board that names 328.
        // That is Phase 6's "read the registry by reference" and it is not built;
        // this is the number it would be measured against.
        const players = reads.find(r => r.collection === 'players');
        expect(players.documents).toBeGreaterThan(600);

        // The shape assertion, deliberately loose: a change that doubles this is
        // interesting, a change of fifty documents is not.
        expect(total).toBeGreaterThan(1000);
        expect(total).toBeLessThan(3000);
    }, 60_000);
});
