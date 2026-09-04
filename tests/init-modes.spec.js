import { test, expect } from '@playwright/test';
import { openApp, gotoTab, trackErrors } from './helpers.js';

// The files in public/ are the real offseason, not sample data, so a fresh
// browser should open on the state the tool would be in if it had been used
// all offseason — a completed draft and the roster that came out of it.
test.describe('initial state', () => {
    test('a fresh browser opens on the worked offseason', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);

        await gotoTab(page, 'roster');
        await page.waitForTimeout(2000);

        // No "initialize roster" wall — it loads the shipped roster itself.
        await expect(page.locator('.roster-bootstrap')).toHaveCount(0);
        await expect(page.locator('.roster-grid').first()).toBeVisible();
        expect(await page.locator('.rv-slot.filled').count()).toBeGreaterThan(50);

        // The draft is complete rather than empty.
        const drafted = await page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}');
            return (s.draftedPlayers || []).length;
        });
        expect(drafted).toBeGreaterThan(200);

        expect(errors).toEqual([]);
    });

    test('roster cards show how each player arrived', async ({ page }) => {
        await openApp(page);
        await gotoTab(page, 'roster');
        await page.waitForTimeout(2000);

        const tags = await page.$$eval('.rv-slot-tag',
            els => [...new Set(els.map(e => e.textContent.trim()).filter(Boolean))]);

        // Free agency and UDFA signings are labelled...
        expect(tags).toContain('FA');
        expect(tags).toContain('UDFA');
        // ...and so is the draft a player came from, in "year/round" form.
        expect(tags.some(t => /^\d{2}\/\d+$/.test(t))).toBe(true);
    });
});

test.describe('re-initialising', () => {
    const chooseSession = async (page, label) => {
        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: label }).click();
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500); // reloads
    };

    test('clean slate empties every stage and survives a reload', async ({ page }) => {
        await openApp(page);
        await chooseSession(page, /Start Clean Slate/);

        await gotoTab(page, 'roster');
        await page.waitForTimeout(1200);
        await expect(page.locator('.roster-bootstrap')).toHaveCount(1);
        expect(await page.locator('.rv-slot.filled').count()).toBe(0);

        const drafted = await page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}');
            return (s.draftedPlayers || []).length;
        });
        expect(drafted).toBe(0);

        // "Empty" has to be recorded, not inferred — otherwise the next load
        // sees no data and seeds the offseason straight back in.
        await page.reload();
        await gotoTab(page, 'roster');
        await page.waitForTimeout(1500);
        expect(await page.locator('.rv-slot.filled').count()).toBe(0);
    });

    test('current state restores the real offseason', async ({ page }) => {
        await openApp(page);
        await chooseSession(page, /Start Clean Slate/);
        await chooseSession(page, /Load Current State/);

        await gotoTab(page, 'roster');
        await page.waitForTimeout(2000);
        expect(await page.locator('.rv-slot.filled').count()).toBeGreaterThan(50);

        const drafted = await page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}');
            return (s.draftedPlayers || []).length;
        });
        expect(drafted).toBeGreaterThan(200);
    });
});
