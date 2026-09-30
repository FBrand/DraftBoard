import { describe, it, expect, beforeEach } from 'vitest';
import { seedApp } from './seedForTests';
import { repository } from '../../src/data/repository';
import { currentSeason } from '../../src/utils/boardRegistry';
import { openDepthCharts } from '../../src/data/depthChartStore';
import { makeSlot } from '../../src/utils/rosterState';
import * as faState from '../../src/utils/faState';

/**
 * Free agency gets the same four operations, from the same implementation.
 *
 * Asserted separately rather than trusted from the roster's suite, because the
 * two stages inject their own loadState/saveState — the guards, the version,
 * the season — and a shared implementation wired up wrongly for one caller looks
 * exactly like a working one until somebody publishes.
 *
 * It matters more here than on the roster: every analyst wants to bring
 * different players in, so a personal version is the normal case and official
 * is what the show settled on.
 */
const chartOf = (wrs) => ({
    positionConfig: { offense: [{ id: 'WR', label: 'WR', slots53: Math.max(1, wrs.length) }], defense: [] },
    depthChart: { WR: wrs.map(n => makeSlot(n)) },
    reserve: [],
    cuts: [],
});
const namesIn = (state) => (state.depthChart.WR ?? []).map(s => s?.name ?? null);
const cutNames = (state) => (state.cuts ?? []).map(s => s?.name ?? s);

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await seedApp();
    await openDepthCharts(currentSeason()?.id);
});

describe('the official free agency board', () => {
    it('is separate from mine, and stamped when published', () => {
        faState.saveState(chartOf(['Higgins']));
        expect(faState.publishOfficial()).toBe(true);
        faState.saveState(chartOf(['Metcalf']));

        expect(namesIn(faState.loadOfficial())).toEqual(['Higgins']);
        expect(namesIn(faState.loadState())).toEqual(['Metcalf']);
        expect(faState.officialStamp()?.by).toBeTruthy();
    });

    it('sends my displaced candidates to the cut panel when I take official', () => {
        faState.saveState(chartOf(['Higgins']));
        faState.publishOfficial();
        faState.saveState(chartOf(['Metcalf']));

        expect(faState.adoptOfficial().displaced).toBe(1);
        const mine = faState.loadState();
        expect(namesIn(mine)).toEqual(['Higgins']);
        expect(cutNames(mine)).toContain('Metcalf');
    });

    it('fills my empty slots from official without touching my candidates', () => {
        faState.saveState(chartOf(['Higgins', 'Metcalf']));
        faState.publishOfficial();
        faState.saveState({ ...chartOf(['Metcalf']), depthChart: { WR: [null, makeSlot('Metcalf')] } });

        expect(faState.fillFromOfficial().filled).toBe(1);
        expect(namesIn(faState.loadState())).toEqual(['Higgins', 'Metcalf']);
    });

    it('does not confuse its chart with the roster’s', () => {
        // Both stages live under the same season and the same scope, and are
        // told apart only by the stage in the path. A shared implementation
        // given the wrong stage key would publish one over the other.
        faState.saveState(chartOf(['Higgins']));
        faState.publishOfficial();

        const roster = faState.loadOfficial();
        expect(namesIn(roster)).toEqual(['Higgins']);
        expect(faState.isOwn()).toBe(true);
    });
});
