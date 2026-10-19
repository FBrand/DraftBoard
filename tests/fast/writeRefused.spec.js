import { test, expect } from '@playwright/test';
import { openWarm } from './helpers.js';

/**
 * What a person sees when the store refuses to save.
 *
 * This was unit-tested and never proven in a browser, which is where it
 * matters: the failure is silent by construction — writes are asynchronous and
 * the edit is already on screen, so nothing about the page says it did not
 * land. The whole point of the sync widget is that "your work is not saved" is
 * information the app owes the user immediately.
 *
 * The refusal is stubbed rather than produced by filling the quota for real.
 * Filling it is not deterministic: how many bytes of headroom are left decides
 * whether the next 71-byte write happens to fit, and a test that passes
 * because the write SUCCEEDED proves nothing at all.
 */
test('a refused write is visible, explained, and does not lose the edit', async ({ page }) => {
    await openWarm(page, 'scouting');
    await page.locator('.sg-row').first().click();
    await expect(page.locator('.side-panel.right-panel')).toBeVisible();

    // Quiet while everything is saving — the widget only speaks up when there
    // is something to say.
    await expect(page.locator('.sync-status')).toHaveCount(0);

    await page.evaluate(() => {
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
            if (String(k).startsWith('db_')) throw new DOMException('quota', 'QuotaExceededError');
            return real.call(this, k, v);
        };
    });

    await page.locator('.side-panel.right-panel button').filter({ hasText: /Avoid/i }).first().click();

    const widget = page.locator('.sync-status');
    await expect(widget).toBeVisible({ timeout: 10_000 });
    await expect(widget).toHaveClass(/sync-status--failed/);
    // The advice is the useful half: "could not save" says to worry, "there is
    // no room left, save to a file" says what to do.
    await expect(widget).toContainText(/no room left/i);
    await expect(widget.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Save to a file' })).toBeVisible();

    // A quota failure is permanent, so it also gets said once, loudly.
    await expect(page.locator('.app-toast')).toContainText(/still on screen/i);

    // And the edit itself must survive — losing it silently is the worst
    // outcome of all.
    await expect(page.locator('.scouting-tag-btn.active, .scouting-tag-btn[aria-pressed=true]')).toHaveCount(1);
});
