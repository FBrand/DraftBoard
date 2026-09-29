import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import {
    readChart, writeChart, hasChart, hasOwnChart, removeChart,
    openDepthCharts, myScope, OFFICIAL, ALL_SCOPES,
} from '../../src/data/depthChartStore';

/**
 * A chart belongs to one person, or to the show.
 *
 * There was one roster and one free agency per season, at one unscoped path,
 * writable by any expert and pushed live to everybody — so two analysts could
 * not each keep their own, and the one they shared belonged to whoever typed
 * last. Every stage is per person now, with one OFFICIAL version of each.
 *
 * The part worth testing is not that the paths differ. It is the reading order:
 * somebody with no chart of his own is looking at official, and the first thing
 * he changes becomes his own without him choosing a starting point — while
 * official is left exactly as it was.
 */
const STAGE = 'rosterState';
const SEASON = 's_scope_test';

const chart = (label) => ({
    positionConfig: { offense: [{ id: 'QB', label, slots53: 1 }], defense: [] },
    depthChart: { QB: [{ name: label }] },
    reserve: [],
    cuts: [],
});
const labelIn = (state) => state.positionConfig.offense[0]?.label ?? null;

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openDepthCharts(SEASON);
});

describe('whose chart it is', () => {
    it('keeps mine and official apart', async () => {
        writeChart(STAGE, SEASON, chart('MINE'));
        writeChart(STAGE, SEASON, chart('OFFICIAL'), OFFICIAL);

        expect(labelIn(readChart(STAGE, SEASON))).toBe('MINE');
        expect(labelIn(readChart(STAGE, SEASON, OFFICIAL))).toBe('OFFICIAL');
    });

    it('shows me official when I have none of my own', () => {
        writeChart(STAGE, SEASON, chart('OFFICIAL'), OFFICIAL);

        expect(labelIn(readChart(STAGE, SEASON))).toBe('OFFICIAL');
        // And says, when asked plainly, that it is not mine — which is what a
        // read-only screen needs to know before offering to edit it.
        expect(hasChart(STAGE, SEASON)).toBe(true);
        expect(hasOwnChart(STAGE, SEASON)).toBe(false);
    });

    it('forks on my first change and stops following official', () => {
        writeChart(STAGE, SEASON, chart('OFFICIAL'), OFFICIAL);
        expect(labelIn(readChart(STAGE, SEASON))).toBe('OFFICIAL');

        writeChart(STAGE, SEASON, chart('MINE'));
        expect(hasOwnChart(STAGE, SEASON)).toBe(true);

        // Official moves. Mine does not follow it, which is the whole point of
        // a personal version — and adopting it is a separate, explicit act.
        writeChart(STAGE, SEASON, chart('OFFICIAL AGAIN'), OFFICIAL);
        expect(labelIn(readChart(STAGE, SEASON))).toBe('MINE');
        expect(labelIn(readChart(STAGE, SEASON, OFFICIAL))).toBe('OFFICIAL AGAIN');
    });

    it('never writes through the fallback', () => {
        // The failure this guards against: somebody with no chart of his own is
        // shown official, edits it, and the edit lands in everybody's copy. A
        // read falls back; a write must not.
        writeChart(STAGE, SEASON, chart('OFFICIAL'), OFFICIAL);
        writeChart(STAGE, SEASON, chart('MINE'));

        expect(labelIn(readChart(STAGE, SEASON, OFFICIAL))).toBe('OFFICIAL');
    });

    it('has nothing for anybody when nothing has been written', () => {
        expect(hasChart(STAGE, SEASON)).toBe(false);
        expect(hasOwnChart(STAGE, SEASON)).toBe(false);
        expect(readChart(STAGE, SEASON).depthChart).toEqual({});
    });

    it('scraps one scope without touching another', async () => {
        writeChart(STAGE, SEASON, chart('MINE'));
        writeChart(STAGE, SEASON, chart('OFFICIAL'), OFFICIAL);

        await removeChart(STAGE, SEASON, myScope());

        expect(hasOwnChart(STAGE, SEASON)).toBe(false);
        // Falls back to official again, which is still there.
        expect(labelIn(readChart(STAGE, SEASON))).toBe('OFFICIAL');
    });

    it('scraps every scope it can name when a season is rolled back', async () => {
        writeChart(STAGE, SEASON, chart('MINE'));
        writeChart(STAGE, SEASON, chart('OFFICIAL'), OFFICIAL);

        await removeChart(STAGE, SEASON, ALL_SCOPES);

        expect(hasChart(STAGE, SEASON)).toBe(false);
        expect(readChart(STAGE, SEASON, OFFICIAL).depthChart).toEqual({});
    });
});
