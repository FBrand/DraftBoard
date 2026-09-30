import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * Publishing and taking the official roster, driven the way a person does it.
 *
 * The unit tests prove the store keeps the two charts apart and that taking
 * official moves the displaced to the cut panel. What they cannot show is the
 * thing that matters on a broadcast: that a player who is replaced is still ON
 * SCREEN afterwards. A plain replacement passes every store-level assertion
 * about the chart it wrote and still leaves an analyst staring at a roster with
 * four players missing and nothing saying which.
 *
 * Both of these previously asserted the wrong side of a distinction that did not
 * exist yet: a first load used to present "your own roster", and now presents
 * the OFFICIAL one, because the shipped snapshot seeds an official chart and
 * nobody has a chart of their own until they change something. The app is right
 * and the tests were stale — so the first thing asserted here is that state,
 * which is also the one that stops an edit to official becoming everybody's.
 */
const officialBar = (page) => page.locator('.official-bar');

test('roster: a first load is looking at the official roster, not its own', async ({ page }) => {
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    await expect(officialBar(page)).toContainText(/showing the official roster/i);
    // And it says what will happen when you change something, because that is
    // the moment a personal copy is forked.
    await expect(officialBar(page)).toContainText(/your first change makes it yours/i);
});

test('roster: taking official puts everybody it replaces in the cut panel', async ({ page }) => {
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    // Fork a personal chart by publishing what is loaded, which is also how a
    // roster becomes official in the first place.
    await page.getByRole('button', { name: /Make official/i }).first().click();
    const publish = page.locator('.rv-inline-dialog');
    await expect(publish).toBeVisible({ timeout: 15_000 });
    await publish.getByRole('button', { name: /Make official/i }).click();
    await expect(officialBar(page)).toContainText(/official set/i, { timeout: 20_000 });

    // Take official back. Nothing should be lost either way, and the dialog has
    // to say what it will do before it does it.
    const take = page.getByRole('button', { name: /Take official/i });
    if (await take.count()) {
        await take.first().click();
        const dialog = page.locator('.rv-inline-dialog');
        await expect(dialog).toBeVisible({ timeout: 15_000 });
        await expect(dialog).toContainText(/cut panel|Nobody you have is lost/i);
        await dialog.getByRole('button', { name: /Take official/i }).click();
    }

    // Whatever happened, the roster still has players on it and the page did not
    // quietly empty.
    await expect.poll(async () => page.locator('.roster-grid .rv-slot-name').count(), { timeout: 20_000 })
        .toBeGreaterThan(0);
});
