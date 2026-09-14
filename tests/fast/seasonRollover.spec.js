import { test, expect } from '@playwright/test';
import { openWarm, TABS } from './helpers.js';

/**
 * Rolling over, and rolling back.
 *
 * This is here because the unit tests could not catch it. They read and wrote
 * the STAGE store on both sides — agreeing with themselves and with nothing
 * the app does — while the roster had moved to row documents. So
 * `initialiseSeason` read an empty blob, carried nothing, and the new season
 * fell through to bootstrapping roster.csv: "new season — roster is prefilled,
 * FA is empty", reported twice by the user, with fifteen green tests over it.
 *
 * The only thing that proves the wiring is driving the real flow, so this test
 * earns its place in the browser suite.
 */
const openSeasons = async (page) => {
    // The tab bar scrolls horizontally at phone widths; Manage sits at the end.
    await page.evaluate(() => { document.querySelector('.view-tabbar').scrollLeft = 9999; });
    await page.locator('.app-menu-trigger', { hasText: 'Manage' }).first().click();
    await page.getByRole('menuitem', { name: /Seasons/i }).click();
    await expect(page.locator('.season-modal')).toBeVisible();
};

const countOn = async (page, tab, selector) => {
    await page.getByRole('button', { name: TABS[tab], exact: true }).click();
    await page.waitForTimeout(600);
    return page.locator(selector).count();
};

test('a new season starts at free agency, and rolling back restores what was there', async ({ page }) => {
    await openWarm(page, 'roster');
    const rosterBefore = await countOn(page, 'roster', '.rv-slot-name');
    const boardBefore = await countOn(page, 'scouting', '.sg-row');
    expect(rosterBefore).toBeGreaterThan(50);

    await openSeasons(page);
    await page.locator('#season-year').fill('2031');
    await page.getByRole('button', { name: /Roll over/i }).click();
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });

    // An offseason STARTS with last season's roster as free agency's
    // candidates, and ENDS with a 53. So the new roster keeps the shape and
    // none of the players.
    expect(await countOn(page, 'roster', '.rv-slot-name')).toBe(0);
    expect(await countOn(page, 'fa', '.rv-slot-name')).toBe(rosterBefore);

    // And rolling back is a way back to exactly what was there, not an
    // approximation.
    await openSeasons(page);
    await page.getByRole('button', { name: /Roll back to/i }).click();
    await page.getByRole('button', { name: /^Delete /i }).click();
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });

    expect(await countOn(page, 'roster', '.rv-slot-name')).toBe(rosterBefore);
    expect(await countOn(page, 'scouting', '.sg-row')).toBe(boardBefore);
});
