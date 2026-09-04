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

test.describe('clean slate keeps its inputs', () => {
    // A clean slate is the start of an offseason, not an empty app: the
    // draftable pool, the three prepared boards, and last season's roster are
    // inputs you work *from*. Only the offseason's own decisions are cleared.
    const startClean = async (page) => {
        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/ }).click();
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500);
    };

    test('free agency opens on last season\'s roster', async ({ page }) => {
        await openApp(page);
        await startClean(page);

        await gotoTab(page, 'fa');
        await page.waitForTimeout(2000);

        const names = await page.$$eval('.rv-slot-name', els => els.map(e => e.textContent.trim()));
        expect(names.length).toBeGreaterThan(20);

        // Holdovers and earlier draft classes are there...
        expect(names).toContain('Creed Humphrey');
        expect(names).toContain('Trey Smith');
        // ...and nobody acquired during the 2026 offseason is.
        expect(names).not.toContain('Kenneth Walker');   // 2026 free agent
        expect(names).not.toContain('Peter Woods');      // 2026 first-rounder
    });

    test('the draftable pool and the prepared boards survive', async ({ page }) => {
        await openApp(page);
        await startClean(page);

        // Draft board still has its players, just nobody drafted yet.
        await gotoTab(page, 'draft');
        await page.waitForTimeout(1200);
        expect(await page.locator('.center-board-container .player-card').count()).toBeGreaterThan(100);
        await expect(page.locator('.center-board-container .player-card.drafted')).toHaveCount(0);

        // All three boards still load, and still differ from each other.
        await gotoTab(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');
        const top = () => page.$$eval('.scouting-rank-row',
            r => r.slice(0, 8).map(x => x.querySelector('.player-name')?.textContent.trim()));
        const consensus = await top();
        expect(consensus.filter(Boolean).length).toBe(8);

        await page.locator('.board-switcher .switcher-btn', { hasText: 'Ryan' }).click();
        await page.waitForTimeout(800);
        expect(await top()).not.toEqual(consensus);
    });
});
