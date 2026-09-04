import { test, expect } from '@playwright/test';
import { openApp, gotoTab, trackErrors } from './helpers.js';

// The app kept the active tab in localStorage and had no router, so no URL
// ever identified anything — you couldn't send someone the roster, one
// analyst's board, or a player. Everything downstream of sharing depends on
// this, so these guard that the URL is now the source of truth.
test.describe('linkable views', () => {
    test('switching stage puts it in the URL', async ({ page }) => {
        await openApp(page);

        await gotoTab(page, 'roster');
        expect(new URL(page.url()).searchParams.get('view')).toBe('roster');

        await gotoTab(page, 'scouting');
        expect(new URL(page.url()).searchParams.get('view')).toBe('scouting');
    });

    test('opening a link lands on that stage', async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto('/?view=roster');
        await page.waitForTimeout(2000);

        await expect(page.getByRole('button', { name: '🏈 Roster', exact: true })).toHaveClass(/active/);
        await expect(page.locator('.roster-grid').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('a shared link beats the recipient\'s last-used view', async ({ page }) => {
        // Land on Roster so localStorage remembers it...
        await openApp(page);
        await gotoTab(page, 'roster');
        await page.waitForTimeout(500);

        // ...then follow a link to a different stage.
        await page.goto('/?view=udfa');
        await page.waitForTimeout(1200);
        await expect(page.getByRole('button', { name: '🪧 UDFA', exact: true })).toHaveClass(/active/);
    });

    test('back and forward move between stages', async ({ page }) => {
        await openApp(page);
        await gotoTab(page, 'roster');
        await gotoTab(page, 'udfa');

        await page.goBack();
        await page.waitForTimeout(800);
        expect(new URL(page.url()).searchParams.get('view')).toBe('roster');
        await expect(page.getByRole('button', { name: '🏈 Roster', exact: true })).toHaveClass(/active/);

        await page.goForward();
        await page.waitForTimeout(800);
        expect(new URL(page.url()).searchParams.get('view')).toBe('udfa');
    });

    test('an unknown view falls back rather than rendering nothing', async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto('/?view=not-a-stage');
        await page.waitForTimeout(1500);

        // Some stage is showing, and the app didn't break.
        await expect(page.locator('.roster-view, .draft-view-shell').first()).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('linkable scouting', () => {
    test('the board and the selected player are both in the URL', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        await page.locator('.board-switcher .switcher-btn', { hasText: 'Dan' }).click();
        await page.waitForTimeout(800);
        expect(new URL(page.url()).searchParams.get('board')).toBe('dan');

        const name = await page.locator('.scouting-rank-row').first().locator('.player-name').innerText();
        await page.locator('.scouting-rank-row').first().locator('.scouting-rank-card').click();
        await page.waitForTimeout(500);
        expect(new URL(page.url()).searchParams.get('player')).toBe(name);
    });

    test('opening that link shows the same analyst on the same player', async ({ page }) => {
        // Find a player who exists on Dan's board.
        await openApp(page, 'scouting');
        await page.locator('.board-switcher .switcher-btn', { hasText: 'Dan' }).click();
        await page.waitForTimeout(800);
        const name = await page.locator('.scouting-rank-row').nth(2).locator('.player-name').innerText();

        await page.goto(`/?view=scouting&board=dan&player=${encodeURIComponent(name)}`);
        await page.waitForSelector('.scouting-layout');
        await page.waitForTimeout(1200);

        await expect(page.locator('.board-switcher .switcher-btn.active')).toHaveText('Dan');
        await expect(page.locator('.scouting-controls-header strong')).toHaveText(name);
    });
});
