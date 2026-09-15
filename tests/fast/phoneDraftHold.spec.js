import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * The double-click guard, on a phone.
 *
 * The guard holds a drafted player in the list for 1200ms so the row under
 * your finger does not move out from under a second click. It was verified
 * with a MOUSE. A finger is where it matters more: the list is off-canvas
 * behind `.sidebar-toggle.toggle-left` at 390px, there is no hover to warn
 * you, and a held card that still looks draftable invites a second tap.
 *
 * Runs under both projects. On a desktop the panel is already open and the
 * toggle is never touched, so this is the same flow on both devices rather
 * than a phone-only special case.
 */
const listVisible = (page) => page.evaluate(() => {
    const el = document.querySelector('.left-panel');
    if (!el) return false;
    return getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().x > -10;
});

async function openList(page) {
    // Give the panel a chance to arrive before concluding it is off-canvas.
    // Checking once, immediately, reported "hidden" on a DESKTOP simply
    // because the panel had not rendered yet — and then hunted for a toggle
    // that only exists on a phone.
    await page.waitForSelector('.left-panel', { state: 'attached', timeout: 45_000 });
    if (await listVisible(page)) return;

    const toggle = page.locator('.sidebar-toggle.toggle-left').first();
    await expect(toggle, 'the list is off-canvas and there is no toggle to open it').toHaveCount(1);
    await toggle.click();
    await expect.poll(() => listVisible(page), { timeout: 10_000 }).toBe(true);
}

const picks = (page) => page.evaluate(() =>
    [...document.querySelectorAll('.center-board-container .player-card')]
        .map(c => c.innerText.replace(/\s+/g, ' ').trim())
        .filter(t => /\bPK\s*\d/.test(t)));

test('draft: on a phone too, a double-tap takes one player', async ({ page }) => {
    await openWarm(page, 'draft');
    await page.waitForSelector('.center-board-container', { timeout: 45_000 });
    await openList(page);

    // Clear the shipped draft, which is complete — with no picks left, a tap
    // on a remaining player correctly opens SIGN UDFA instead of drafting,
    // and this would be testing the wrong flow.
    await page.locator('button').filter({ hasText: /^More/ }).first().click();
    await page.locator('[role="menuitem"], .app-menu-item').filter({ hasText: /Reset Draft/i }).first().click();
    const confirm = page.locator('button').filter({ hasText: /Reset|Clear|Confirm|Yes/i }).last();
    if (await confirm.count()) await confirm.click();
    await expect.poll(async () => (await picks(page)).length, { timeout: 30_000 }).toBe(0);

    await openList(page);
    await page.locator('.left-panel .player-card').first().click({ clickCount: 2, delay: 30 });
    await page.waitForTimeout(3_000);

    expect(await picks(page), 'a double-tap took more than one player').toHaveLength(1);
});
