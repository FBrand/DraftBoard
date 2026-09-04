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
        await expect(box.locator('.scouting-group-field')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(box).toHaveCount(0);
    });

    test('the roster bootstrap screen fits the viewport', async ({ page }) => {
        // The screen only appears in clean mode now that seeded mode loads the
        // shipped roster, so put the app in clean mode rather than skipping —
        // a test that always skips silently covers nothing.
        await openApp(page);
        await page.evaluate(() => localStorage.setItem('draftboard_init_mode', 'clean'));
        await page.reload();
        await gotoTab(page, 'roster');
        await page.waitForTimeout(800);

        await expect(page.locator('.roster-bootstrap-title')).toBeVisible();

        const vw = page.viewportSize().width;
        for (const sel of ['.roster-bootstrap-title', '.roster-bootstrap-actions']) {
            const box = await page.locator(sel).boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(-1);
            expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
        }
    });
});
