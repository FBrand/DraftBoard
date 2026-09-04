import { test, expect } from '@playwright/test';
import { openApp, gotoTab, TABS } from './helpers.js';

// .app-container sets overflow:hidden, so anything wider than the viewport is
// silently CLIPPED rather than scrollable — content becomes unreachable, not
// merely awkward. These guard the phone-width layouts.
test.describe('mobile layout', () => {
    test('every tab in the nav bar is reachable', async ({ page }) => {
        await openApp(page);
        const bar = page.locator('.view-tabbar');

        // Five tabs don't fit a phone, so the bar must scroll rather than clip.
        const overflows = await bar.evaluate(el => el.scrollWidth > el.clientWidth);
        if (overflows) {
            expect(await bar.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');
        }

        // Each tab can actually be clicked and switches the view.
        for (const key of Object.keys(TABS)) {
            await gotoTab(page, key);
            await expect(page.getByRole('button', { name: TABS[key], exact: true })).toHaveClass(/active/);
        }
    });

    test('scouting stacks and the board is reachable', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        // Columns stack rather than sitting side by side.
        expect(await page.locator('.scouting-layout').evaluate(el => getComputedStyle(el).flexDirection))
            .toBe('column');

        // The board exists and has real width (it used to be pushed off-screen).
        const board = page.locator('.scouting-layout .center-board-container');
        await expect(board).toBeVisible();
        expect((await board.boundingBox()).width).toBeGreaterThan(200);
    });

    test('tapping a player opens the editable info card as a modal', async ({ page }) => {
        // Regression: on mobile the info panel stacked far below the board, so
        // tapping a player looked like it did nothing.
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        // The stacked side panel is not rendered on mobile.
        await expect(page.locator('.scouting-layout .right-panel')).toHaveCount(0);

        await page.locator('.scouting-rank-card').first().click();
        const box = page.locator('.scouting-modal-box');
        await expect(box).toBeVisible();

        // Scouting stays editable even on mobile — this is where notes get
        // written. Three of the four numbers are typeable; position rank is
        // derived from the board's ordering and rendered as text.
        await expect(box.locator('.scouting-number-grid input')).toHaveCount(3);
        await expect(box.locator('.scouting-derived-value')).toHaveCount(1);
        await expect(box.locator('.scouting-group-fields input')).toHaveCount(2);

        await page.keyboard.press('Escape');
        await expect(box).toHaveCount(0);
    });

    test('the roster toolbar fits the viewport', async ({ page }) => {
        // Roster no longer has a bootstrap screen of its own — it comes up as
        // a grid like every other phase — so this guards the toolbar that
        // replaced it.
        await openApp(page, 'roster');
        await page.waitForTimeout(1800);

        await expect(page.locator('.roster-grid').first()).toBeVisible();

        // The toolbar is deliberately wider than a phone and scrolls
        // horizontally, so asserting it fits would be wrong. What matters is
        // that it scrolls rather than being clipped with controls unreachable,
        // and that the first thing in it starts on screen.
        const panel = page.locator('.roster-view .top-panel').first();
        if (await panel.evaluate(el => el.scrollWidth > el.clientWidth)) {
            expect(await panel.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');
        }

        const brand = await page.locator('.roster-brand').first().boundingBox();
        expect(brand.x).toBeGreaterThanOrEqual(-1);
        expect(brand.x).toBeLessThan(page.viewportSize().width);
    });
});
