import { test, expect } from '@playwright/test';
import { openApp, gotoTab, trackErrors, TABS } from './helpers.js';

test.describe('smoke', () => {
    test('every tab renders without console errors', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);

        for (const key of Object.keys(TABS)) {
            await gotoTab(page, key);
            // Every view roots itself in one of these two shells.
            await expect(
                page.locator('.roster-view, .draft-view-shell').first()
            ).toBeVisible();
        }

        expect(errors).toEqual([]);
    });

    test('the draft board scrolls vertically', async ({ page }) => {
        // Regression: extracting DraftView broke .app-container's height chain,
        // leaving the board unbounded (~25000px) with nothing to scroll and
        // most of it unreachable below the fold.
        await openApp(page, 'draft');
        await page.getByRole('button', { name: /Full Board/ }).click();
        await page.waitForTimeout(500);

        const box = await page.locator('.center-board-container').evaluate(el => ({
            client: el.clientHeight,
            scroll: el.scrollHeight,
        }));
        expect(box.client).toBeLessThan(2000);
        expect(box.scroll).toBeGreaterThan(box.client);

        await page.locator('.center-board-container').evaluate(el => el.scrollTo({ top: 2000 }));
        await page.waitForTimeout(200);
        const scrolled = await page.locator('.center-board-container').evaluate(el => el.scrollTop);
        expect(scrolled).toBeGreaterThan(0);
    });

    test('the right panel auto-scroll does not move other panels', async ({ page }) => {
        // Regression: RightPanel used scrollIntoView, which scrolls every
        // scrollable ancestor — it dragged the board and left panel with it.
        await openApp(page, 'draft');
        await page.waitForTimeout(800);

        const before = await page.evaluate(() => ({
            window: window.scrollY,
            center: document.querySelector('.center-board-container')?.scrollTop,
        }));

        await page.locator('.center-board-container .player-card').first().click();
        await page.waitForTimeout(800);

        const after = await page.evaluate(() => ({
            window: window.scrollY,
            center: document.querySelector('.center-board-container')?.scrollTop,
        }));
        expect(after).toEqual(before);
    });
});
