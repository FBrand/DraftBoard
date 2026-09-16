import { test } from '@playwright/test';
import { expect, openWarm, dragTo, depthChartDragReachable } from './helpers';

/**
 * Free Agency's CSV, out and back in.
 *
 * The field-level quoting has its own unit tests; what none of them exercise
 * is the trip through the real UI — the menu, a Blob download, a file input,
 * and `history.reset` on the way back. The file has to carry everything the
 * grid is showing: the position rows, their slot counts, WHICH slot each
 * candidate sits in and the ZONE that slot belongs to. A round trip that drops
 * the zone would quietly move every candidate between "top choice" and "other
 * options"; one that drops a slot index would compact the chart and pretend
 * nothing happened.
 *
 * The drag in the middle matters: without a change between export and import,
 * an import that did nothing at all would pass.
 */
const snapshot = (page) => page.evaluate(() => ({
    positions: [...document.querySelectorAll('.rv-pos-label')].map(e => e.textContent.trim()),
    counts: [...document.querySelectorAll('.rv-pos-count')].map(e => e.textContent.trim()),
    slots: [...document.querySelectorAll('.rv-slot')].map(el => {
        const zone = [...el.classList].find(c => c.startsWith('zone-')) ?? 'zone-none';
        return `${zone}|${el.querySelector('.rv-slot-name')?.textContent.trim() ?? ''}`;
    }),
}));

const openMenu = async (page) => {
    await page.locator('.top-actions button').last().click();
    await page.waitForTimeout(400);
};

test('free agency: the candidate CSV comes back the way it went out', async ({ page }) => {
    await openWarm(page, 'fa');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    test.skip(!(await depthChartDragReachable(page)),
        'dragTo cannot reach a drop target at this width (a finger can, via edge auto-scroll)');


    const before = await snapshot(page);
    expect(before.positions.length).toBeGreaterThan(0);
    expect(before.slots.some(s => !s.endsWith('|'))).toBe(true);

    await openMenu(page);
    const downloading = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByText('Export Candidates CSV…', { exact: false }).click();
    const csvPath = await (await downloading).path();

    // Change the chart, so an import that does nothing cannot pass.
    const source = page.locator('.rv-slot.filled').first();
    await source.scrollIntoViewIfNeeded();
    const emptyIdx = await page.evaluate(() => [...document.querySelectorAll('.rv-slot')]
        .findIndex(el => !el.querySelector('.rv-slot-name')
            && !el.closest('.roster-cuts') && !el.closest('.roster-ir')));
    expect(emptyIdx).toBeGreaterThanOrEqual(0);
    const dest = page.locator('.rv-slot').nth(emptyIdx);
    await dest.scrollIntoViewIfNeeded();
    await dragTo(page, source, dest);
    await page.waitForTimeout(2_000);

    const changed = await snapshot(page);
    expect(changed.slots).not.toEqual(before.slots);

    await openMenu(page);
    await page.setInputFiles('input[type="file"][accept=".csv"]', csvPath);
    await page.waitForTimeout(3_500);

    const after = await snapshot(page);
    expect(after.positions).toEqual(before.positions);
    expect(after.counts).toEqual(before.counts);
    expect(after.slots).toEqual(before.slots);
});
