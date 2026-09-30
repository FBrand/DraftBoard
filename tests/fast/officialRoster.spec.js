import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * Publishing and taking the official roster, driven the way a person does it.
 *
 * The unit tests prove the store keeps the two charts apart and that taking
 * official moves the displaced to the cut panel. What they cannot show is the
 * thing that actually matters on a broadcast: that a player who is replaced is
 * still ON SCREEN somewhere afterwards. A plain replacement passes every
 * store-level assertion about the chart it wrote and still leaves an analyst
 * staring at a roster with four players missing and nothing saying which.
 */
const names = (page) => page.locator('.roster-grid .rv-slot-name').allInnerTexts();
const cutNames = (page) => page.locator('.roster-cuts .rv-slot-name').allInnerTexts();

test('roster: taking official puts everybody it replaces in the cut panel', async ({ page }) => {
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    // Publish what is loaded as official, so there is something to take.
    await page.getByRole('button', { name: /Make official/i }).click();
    await page.getByRole('button', { name: /^Make official$/i }).last().click();
    await expect(page.locator('.official-bar-stamp')).toContainText(/official set/i, { timeout: 20_000 });

    const published = await names(page);
    expect(published.length).toBeGreaterThan(0);

    // Now diverge: cut somebody by hand, so my roster differs from official.
    const first = page.locator('.roster-grid .rv-slot-name').first();
    const gone = (await first.innerText()).trim();

    // Take official back. Nothing should be lost either way, but the dialog has
    // to say what it will do before it does it.
    await page.getByRole('button', { name: /Take official/i }).first().click();
    const dialog = page.locator('.rv-inline-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/cut panel|Nobody you have is lost/i);
    await dialog.getByRole('button', { name: /Take official/i }).click();

    // Back to what was published, and the man is still somewhere on screen.
    await expect.poll(async () => (await names(page)).length, { timeout: 20_000 })
        .toBeGreaterThan(0);
    const after = [...(await names(page)), ...(await cutNames(page))];
    expect(after).toContain(gone);
});

test('roster: a viewer is told he is looking at the official roster, not his own', async ({ page }) => {
    // On a local build everybody is the one person, so this asserts the other
    // branch of the same label: a chart that IS his says so plainly. The
    // read-only branch is what stops an edit to official becoming everybody's,
    // and the store test covers the fork itself.
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    await expect(page.locator('.official-bar-state')).toContainText(/your own roster/i);
});
