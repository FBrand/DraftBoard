import { test, expect } from '@playwright/test';
import { openApp, gotoTab, ensureRoster, trackErrors } from './helpers.js';

test.describe('ui conventions', () => {
    test('no native browser dialogs anywhere', async ({ page }) => {
        // This is a broadcast tool: window.alert/confirm/prompt are unstyled OS
        // chrome that looks wrong on stream, so the app uses its own dialogs.
        const errors = trackErrors(page);
        await openApp(page);
        await ensureRoster(page);

        await gotoTab(page, 'fa');
        await page.getByRole('button', { name: '+ Add Position' }).first().click();
        await page.waitForTimeout(400);
        await expect(page.locator('.rv-inline-dialog')).toBeVisible();

        expect(errors.filter(e => e.includes('native dialog'))).toEqual([]);
    });

    test('Escape closes every overlay', async ({ page }) => {
        await openApp(page, 'draft');
        await page.waitForTimeout(500);

        // Picks modal (now behind the menu)
        await page.locator('.top-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Update Our Picks/ }).click();
        await expect(page.locator('.modal-overlay')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-overlay')).toHaveCount(0);

        // Unranked player modal
        await page.getByRole('button', { name: 'Draft Unranked Player' }).click();
        await expect(page.locator('.modal-overlay')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-overlay')).toHaveCount(0);
    });

    test('menus escape their clipping parents and close correctly', async ({ page }) => {
        // Regression: the view shells set overflow:hidden, which clipped the
        // dropdown so it vanished behind the panels below it. The list now
        // portals to <body>.
        await openApp(page);
        await ensureRoster(page);

        await page.locator('.top-actions .app-menu-trigger').click();
        const list = page.locator('.app-menu-list');
        await expect(list).toBeVisible();

        // Rendered outside the clipping view shell...
        const parentIsBody = await list.evaluate(el => el.parentElement === document.body);
        expect(parentIsBody).toBe(true);

        // ...and actually visible where it was placed, not covered by the grid.
        const box = await list.boundingBox();
        const topHit = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return !!el?.closest('.app-menu-list');
        }, { x: box.x + box.width / 2, y: box.y + 10 });
        expect(topHit).toBe(true);

        await page.keyboard.press('Escape');
        await expect(list).toHaveCount(0);

        // Closes on outside click too
        await page.locator('.top-actions .app-menu-trigger').click();
        await expect(page.locator('.app-menu-list')).toBeVisible();
        await page.locator('.roster-brand').click();
        await expect(page.locator('.app-menu-list')).toHaveCount(0);
    });

    test('the sync action reports what it did', async ({ page }) => {
        // It's additive-only and skips silently in several cases; without a
        // summary a run that placed nobody looks like a dead button.
        await openApp(page);
        await ensureRoster(page);

        await page.getByRole('button', { name: /Sync from FA\/Draft\/UDFA/ }).click();
        await expect(page.locator('.app-toast')).toBeVisible();
        await expect(page.locator('.app-toast')).toContainText(/Placed|Nothing/);

        await page.locator('.app-toast button').click();
        await expect(page.locator('.app-toast')).toHaveCount(0);
    });
});
