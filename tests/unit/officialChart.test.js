import { describe, it, expect, beforeEach } from 'vitest';
import { seedApp } from './seedForTests';
import { repository } from '../../src/data/repository';
import { currentSeason } from '../../src/utils/boardRegistry';
import { openDepthCharts } from '../../src/data/depthChartStore';
import {
    saveState, loadState, loadOfficial, publishOfficial, adoptOfficial,
    fillFromOfficial, officialStamp, isOwn, makeSlot, countDisplaced,
} from '../../src/utils/rosterState';

/**
 * Publishing and adopting, which are the only two ways a personal roster and
 * the official one meet.
 *
 * Nothing merges on its own: one analyst having a player where official has
 * somebody else is a disagreement, not a conflict, and a rule that picks a
 * winner has the app asserting an opinion nobody holds. So there are two
 * deliberate acts, and the important one is adopting — because the obvious
 * implementation of it, replacing the chart outright, loses every player the
 * analyst had who official does not, silently and with no way to see who.
 */
const named = (name) => makeSlot(name);

const chartOf = (qbs, rbs = []) => ({
    positionConfig: {
        offense: [{ id: 'QB', label: 'QB', slots53: qbs.length }, { id: 'RB', label: 'RB', slots53: Math.max(1, rbs.length) }],
        defense: [],
    },
    depthChart: { QB: qbs.map(named), RB: rbs.map(named) },
    reserve: [],
    cuts: [],
});
const namesIn = (state, row) => (state.depthChart[row] ?? []).map(s => s?.name ?? null);
const cutNames = (state) => (state.cuts ?? []).map(s => s?.name ?? s);

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await seedApp();
    await openDepthCharts(currentSeason()?.id);
});

describe('publishing a roster as official', () => {
    it('records who did it and when, because it overwrites somebody else’s', () => {
        saveState(chartOf(['Mahomes']));
        expect(publishOfficial()).toBe(true);

        const stamp = officialStamp();
        expect(stamp?.by).toBeTruthy();
        expect(Date.parse(stamp.at)).not.toBeNaN();
    });

    it('does not become my chart, and does not stop being mine', () => {
        saveState(chartOf(['Mahomes']));
        publishOfficial();

        expect(namesIn(loadOfficial(), 'QB')).toEqual(['Mahomes']);
        expect(isOwn()).toBe(true);
    });
});

describe('adopting the official roster', () => {
    it('moves everybody it would have lost to the cut panel', () => {
        // Official has Mahomes at QB. I have Fields, and Pacheco at RB, neither
        // of whom official carries. A plain replacement loses both without
        // saying so — that is the failure this exists to prevent.
        saveState(chartOf(['Mahomes']));
        publishOfficial();
        saveState(chartOf(['Fields'], ['Pacheco']));

        const result = adoptOfficial();
        expect(result.displaced).toBe(2);

        const mine = loadState();
        expect(namesIn(mine, 'QB')).toEqual(['Mahomes']);
        expect(cutNames(mine)).toEqual(expect.arrayContaining(['Fields', 'Pacheco']));
    });

    it('cuts nobody who is in official as well', () => {
        saveState(chartOf(['Mahomes']));
        publishOfficial();
        saveState(chartOf(['Mahomes']));

        expect(adoptOfficial().displaced).toBe(0);
        expect(cutNames(loadState())).toEqual([]);
    });

    it('is nothing to do when nobody has published', () => {
        saveState(chartOf(['Fields']));
        expect(adoptOfficial()).toBeNull();
        expect(namesIn(loadState(), 'QB')).toEqual(['Fields']);
    });
});

describe('filling the gaps from official', () => {
    it('fills what I left empty and keeps what I placed', () => {
        saveState(chartOf(['Mahomes', 'Fields']));
        publishOfficial();
        // Mine: Wentz first, nothing second.
        saveState({ ...chartOf(['Wentz']), depthChart: { QB: [named('Wentz'), null], RB: [] } });

        expect(fillFromOfficial().filled).toBe(1);

        const mine = loadState();
        expect(namesIn(mine, 'QB')).toEqual(['Wentz', 'Fields']);
    });

    it('takes nobody away, so running it twice changes nothing the second time', () => {
        saveState(chartOf(['Mahomes']));
        publishOfficial();
        saveState({ ...chartOf(['Wentz']), depthChart: { QB: [named('Wentz')], RB: [] } });

        fillFromOfficial();
        const once = namesIn(loadState(), 'QB');
        expect(fillFromOfficial().filled).toBe(0);
        expect(namesIn(loadState(), 'QB')).toEqual(once);
    });
});

/**
 * The zones the first two versions of this did not look at.
 *
 * `playersNotIn` compared a field that does not exist (caught), then scanned only
 * the depth chart (not caught). Adopting official replaces the whole state, so a
 * player on the adopter's INJURED RESERVE whom official does not carry was
 * neither kept nor cut — gone, with the confirmation dialog stating a number
 * lower than the real loss.
 *
 * The suite that caught the first bug compared depth-chart slots and never built
 * a reserve, which is why the second survived it. These build one.
 */
describe('adopting official, with players outside the depth chart', () => {
    const withReserve = (qbs, reserve, cuts = []) => ({
        positionConfig: { offense: [{ id: 'QB', label: 'QB', slots53: Math.max(1, qbs.length) }], defense: [] },
        depthChart: { QB: qbs.map(n => makeSlot(n)) },
        reserve: reserve.map(n => makeSlot(n)),
        cuts: cuts.map(n => makeSlot(n)),
    });
    const allNames = (state) => [
        ...(state.depthChart.QB ?? []).map(s => s?.name),
        ...(state.reserve ?? []).map(s => s?.name),
        ...(state.cuts ?? []).map(s => s?.name),
    ].filter(Boolean);

    it('keeps a player who was on my injured reserve', () => {
        saveState(withReserve(['Mahomes'], []));
        publishOfficial();
        saveState(withReserve(['Mahomes'], ['Hurt Guy']));

        const result = adoptOfficial();
        // He is displaced, and he is still somewhere.
        expect(result.displaced).toBe(1);
        expect(allNames(loadState())).toContain('Hurt Guy');
    });

    it('keeps a player I had already cut', () => {
        saveState(withReserve(['Mahomes'], []));
        publishOfficial();
        saveState(withReserve(['Mahomes'], [], ['Already Cut']));

        adoptOfficial();
        expect(allNames(loadState())).toContain('Already Cut');
    });

    it('counts him before it moves him, so the dialog does not understate', () => {
        saveState(withReserve(['Mahomes'], []));
        publishOfficial();
        saveState(withReserve(['Mahomes'], ['Hurt Guy'], ['Already Cut']));

        // The number the confirmation shows has to be the number that moves.
        const predicted = countDisplaced();
        const actual = adoptOfficial().displaced;
        expect(predicted).toBe(actual);
        expect(predicted).toBe(2);
    });

    it('does not cut somebody official has on ITS reserve', () => {
        // He is not displaced: official carries him, just not on the 53.
        saveState(withReserve(['Mahomes'], ['Shared Injury']));
        publishOfficial();
        saveState(withReserve(['Mahomes'], ['Shared Injury']));

        expect(adoptOfficial().displaced).toBe(0);
    });
});
