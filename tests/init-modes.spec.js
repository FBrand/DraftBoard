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
        await page.waitForTimeout(1800);
        // Roster behaves like every other phase — a grid, not a screen to get
        // past — and keeps its position rows so there is somewhere to build
        // into and somewhere for Sync to place players.
        await expect(page.locator('.roster-bootstrap')).toHaveCount(0);
        await expect(page.locator('.roster-grid').first()).toBeVisible();
        expect(await page.locator('.rv-pos-label').count()).toBeGreaterThan(10);
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

test.describe('building a roster from the earlier stages', () => {
    test('clean slate can sync FA, draft picks and UDFA into the roster', async ({ page }) => {
        // The whole point of the pipeline: free agency + draft picks + UDFA
        // signings become the initial roster. From a clean slate this used to
        // be impossible — the roster started with no position rows, so Sync
        // resolved every player to no row and silently placed nobody.
        await openApp(page);
        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/ }).click();
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500);

        await gotoTab(page, 'roster');
        await page.waitForTimeout(1800);
        expect(await page.locator('.rv-slot.filled').count()).toBe(0);

        await page.getByRole('button', { name: /Sync from FA\/Draft\/UDFA/ }).click();
        await page.waitForTimeout(800);

        // It reports what it did, and it actually placed people.
        await expect(page.locator('.app-toast')).toContainText(/Placed \d+ player/);
        expect(await page.locator('.rv-slot.filled').count()).toBeGreaterThan(0);
    });
});

test.describe('signing never consumes draft picks', () => {
    // Signing is a roster move. It used to go through draftPlayer, which
    // stamps the *current* pick number and advances the draft — so signing a
    // free agent after nine picks recorded him as pick ten — and it pushed the
    // name onto the injury-reserve pool, so every signing arrived injured.
    test('a roster signing takes no pick and does not land on IR', async ({ page }) => {
        await openApp(page);
        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/ }).click();
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500);

        // Make a few real draft picks first.
        await gotoTab(page, 'draft');
        await page.waitForTimeout(1200);
        for (let i = 0; i < 3; i++) {
            await page.locator('.center-board-container .player-card').first().click();
            await page.waitForTimeout(300);
        }
        const pickBefore = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}').currentPick);

        // Sign someone from the roster view.
        await gotoTab(page, 'roster');
        await page.waitForTimeout(1500);
        const irBefore = await page.locator('.roster-ir .rv-slot-name').count();

        await page.getByRole('button', { name: /SIGN PLAYER/i }).click();
        await page.locator('.modal-content input').first().fill('Testy Signing');
        await page.locator('.modal-content input').nth(1).fill('QB');
        await page.getByRole('button', { name: 'Sign FA', exact: true }).click();
        await page.waitForTimeout(600);

        // He is on the roster...
        expect(await page.$$eval('.rv-slot-name', els => els.map(e => e.textContent.trim())))
            .toContain('Testy Signing');
        // ...not on injury reserve...
        expect(await page.locator('.roster-ir .rv-slot-name').count()).toBe(irBefore);
        // ...and the draft is exactly where it was.
        const pickAfter = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}').currentPick);
        expect(pickAfter).toBe(pickBefore);
    });

    test('UDFA signing is held until the draft ends', async ({ page }) => {
        await openApp(page);
        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/ }).click();
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500);

        await gotoTab(page, 'udfa');
        await page.waitForTimeout(1200);

        // The board is still browsable — seeing who may go undrafted is the
        // point — but nothing can be signed yet.
        expect(await page.locator('.center-board-container .player-card').count()).toBeGreaterThan(50);
        await expect(page.getByRole('button', { name: /Sign Unranked Player/ })).toBeDisabled();
        await expect(page.locator('.udfa-locked-note')).toBeVisible();

        const before = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}').currentPick);
        await page.locator('.center-board-container .player-card').first().click();
        await page.waitForTimeout(500);
        const after = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('nfl_draft_board_state') || '{}').currentPick);
        expect(after).toBe(before);
    });
});
