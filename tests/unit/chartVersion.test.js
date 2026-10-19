import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import { readChart, writeChart, bandsPath, rowsPath } from '../../src/data/depthChartStore';

/**
 * A chart says which shape it is written in.
 *
 * `rosterState.migrate` and `faState.migrate` both refuse data from a newer
 * app — "written by a newer app — don't guess" — and the header above
 * STATE_VERSION says why it exists: without a version "there was no way to tell
 * an old shape from a current one, so a stale blob was simply trusted and
 * rendered wrong".
 *
 * That protection quietly stopped working when the chart stopped being a blob
 * and became row documents: nothing wrote a version any more, so every read
 * looked like the current shape whatever wrote it. Both callers do
 *
 *     migrate({ version: STATE_VERSION, ...readChart(...) })
 *
 * and the spread cannot override a version that is not there. The guard was
 * unreachable, while two files' comments described it as load-bearing.
 */
const STAGE = 'rosterState';
const SEASON = 's_version_test';

beforeEach(async () => {
    repository.invalidate();
    await Promise.all([
        repository.ready(rowsPath(STAGE, SEASON)),
        repository.ready(bandsPath(STAGE, SEASON)),
    ]);
});

const sampleChart = (version) => ({
    version,
    positionConfig: { offense: [{ id: 'QB', label: 'QB', slots53: 2 }], defense: [] },
    depthChart: { QB: [{ name: 'Patrick Mahomes', zone: '53' }] },
    reserve: [],
    cuts: [],
});

describe('the shape a chart was written in', () => {
    it('is recorded when the chart is written', () => {
        writeChart(STAGE, SEASON, sampleChart(1));
        expect(readChart(STAGE, SEASON).version).toBe(1);
    });

    it('comes back as whatever wrote it, so a newer shape can be recognised', () => {
        writeChart(STAGE, SEASON, sampleChart(2));
        const back = readChart(STAGE, SEASON);
        expect(back.version).toBe(2);
        // Which is what lets migrate() refuse it rather than render it wrong.
        expect(back.version).toBeGreaterThan(1);
    });

    it('still reads a chart written before versions were stored', () => {
        // Anything already in a browser has rows and bands and no version
        // document. It is the shape this app writes, so it reads as current.
        writeChart(STAGE, SEASON, sampleChart(1));
        repository.remove(bandsPath(STAGE, SEASON), 'meta');

        const back = readChart(STAGE, SEASON);
        expect(back.version == null || back.version === 1).toBe(true);
        expect(back.depthChart.QB).toHaveLength(1);
    });

    it('does not disturb the rows or the bands', () => {
        writeChart(STAGE, SEASON, sampleChart(1));
        const back = readChart(STAGE, SEASON);
        expect(back.positionConfig.offense).toHaveLength(1);
        expect(back.depthChart.QB[0].name).toBe('Patrick Mahomes');
    });
});

describe('a chart from a newer build', () => {
    it('is refused rather than rendered, and is not overwritten', async () => {
        const roster = await import('../../src/utils/rosterState');
        const registry = await import('../../src/utils/boardRegistry');
        await registry.openBoards();

        const season = registry.viewedSeason()?.id ?? null;
        const stage = 'rosterState';
        expect(season).toBeTruthy();   // or the test proves nothing

        // Somebody's newer build wrote this.
        roster.saveState({
            positionConfig: { offense: [{ id: 'QB', label: 'QB', slots53: 2 }], defense: [] },
            depthChart: { QB: [{ name: 'A Real Player', zone: '53' }] },
            reserve: [], cuts: [],
        });
        repository.set(bandsPath(stage, season), 'meta', { v: 99 });

        // This build cannot read it.
        expect(roster.loadState()).toBeNull();

        // And must not replace it with what it thinks an empty stage looks like.
        roster.saveState({
            positionConfig: { offense: [], defense: [] },
            depthChart: {}, reserve: [], cuts: [],
        });

        const still = readChart(stage, season);
        expect(still.depthChart.QB).toHaveLength(1);
        expect(still.depthChart.QB[0].name).toBe('A Real Player');
    });
});
