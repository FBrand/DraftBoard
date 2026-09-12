import { test, expect } from '@playwright/test';
import { openWarm, TABS, gotoTab } from './helpers';

/**
 * How the app gives way as the window narrows.
 *
 * Replaces `layout.mobile.spec.js`, and adds the width ladder that nothing
 * covered before — which is why a regression reached the user: the suite ran
 * at one size, 1600x1000, so a layout that collapsed wrongly at 1025 passed
 * every test there was.
 *
 * The contract, in size order:
 *   - the grouped list sheds columns on its own
 *   - then the side panel goes and the player card becomes a modal (1264)
 *   - then the ranking goes, and only then (692)
 * and at every width a row of names is between one and two worst-case widths.
 */
const ROW = 377;   // measured: "??? Emmanuel McNeil-Warren  no position, school, rank"
const PAD = 32;    // the list's own padding, off before multicol sees the width

const readLayout = (page) => page.evaluate(() => {
    const body = document.querySelector('.sg-group-body');
    const list = document.querySelector('.sg-list');
    const rows = [...body.querySelectorAll('.sg-row')].slice(0, 30);
    return {
        ranking: !!document.querySelector('.scouting-layout .left-panel'),
        side: !!document.querySelector('.sg-unmatched-panel'),
        listW: Math.round(list.getBoundingClientRect().width),
        rowW: Math.round(rows[0].getBoundingClientRect().width),
    };
});

const CASES = [
    { w: 1600, ranking: true, side: true },
    { w: 1264, ranking: true, side: true },   // the last width the side panel fits
    { w: 1263, ranking: true, side: false },  // one pixel later it is gone
    { w: 900, ranking: true, side: false },
    { w: 691, ranking: false, side: false },  // and the ranking goes last
];

for (const c of CASES) {
    test(`scouting at ${c.w}px keeps a readable column`, async ({ page }) => {
        await page.setViewportSize({ width: c.w, height: 900 });
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 30_000 });

        const l = await readLayout(page);
        expect(l.ranking, `ranking at ${c.w}`).toBe(c.ranking);
        expect(l.side, `side panel at ${c.w}`).toBe(c.side);

        // Never narrower than one worst-case row (unless the window itself is),
        // never wider than two.
        expect(l.rowW, `row at ${c.w}`).toBeGreaterThanOrEqual(Math.min(ROW, l.listW - PAD) - 2);
        expect(l.rowW, `row at ${c.w}`).toBeLessThanOrEqual(2 * ROW + 2);
    });
}

test('on a phone every stage is reachable and the card opens as a modal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWarm(page);

    // Every tab, not just the ones that fit — the bar scrolls.
    for (const key of Object.keys(TABS)) {
        await gotoTab(page, key);
        await expect(page.locator('.view-tabbar')).toBeVisible();
    }

    await gotoTab(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 30_000 });
    // One column, and nothing pinned to an edge there is no room for.
    const l = await readLayout(page);
    expect(l.ranking).toBe(false);
    expect(l.side).toBe(false);

    await page.locator('.sg-row').first().click();
    const card = page.locator('.scouting-modal-box');
    await expect(card).toBeVisible();

    // Centred, not pinned: equal air on both sides, within a pixel of rounding.
    const box = await card.boundingBox();
    expect(Math.abs(box.x - (390 - box.x - box.width))).toBeLessThanOrEqual(2);
});

test('on a phone every roster control can still be reached', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    // The depth chart itself is WIDER than a phone on purpose — slots run off
    // to the right and you scroll to them. So this is not about fitting. It is
    // about nothing being clipped somewhere you cannot scroll to, which is how
    // a control goes missing rather than merely offscreen.
    const controls = page.locator('.top-actions button, .top-actions .action-pill');
    const n = await controls.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i += 1) {
        const c = controls.nth(i);
        await c.scrollIntoViewIfNeeded();
        const box = await c.boundingBox();
        expect(box, `control ${i} has no box`).not.toBeNull();
        expect(box.width, `control ${i} is zero-width`).toBeGreaterThan(0);
        expect(box.x, `control ${i} sits off the left edge`).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, `control ${i} cannot be scrolled into view`)
            .toBeLessThanOrEqual(390 + 1);
    }
});
