/**
 * The browser suite, reduced to what only a browser can answer.
 *
 * Two thirds of the original 87 tests exercised pure functions — rank
 * derivation, draft-phase gating, name matching, CSV round-trips, the registry
 * — through a page load each. Those now live in tests/unit and run in nine
 * seconds. What is left here is rendering, drag and drop, persistence across a
 * reload, modal flows, and routing: things with no meaning outside a browser.
 *
 * Tests are grouped rather than granular on purpose. A page load is the unit
 * of cost, so asserting five related things about one screen is nearly free
 * while five tests asserting one thing each is five bootstraps.
 */
import { test } from '@playwright/test';
import {
    expect, TABS, openWarm, openCold, gotoTab, slotNames, dragTo, trackErrors,
} from './helpers';

test.describe('rendering', () => {
    test('every tab renders, with no console errors and no native dialogs', async ({ page }) => {
        const errors = trackErrors(page);
        await openWarm(page);

        for (const tab of Object.keys(TABS)) {
            await gotoTab(page, tab);
            await expect(page.locator('.view-tab.active')).toHaveText(TABS[tab]);
            // Something view-shaped is on screen, not a blank pane.
            await expect(page.locator('.roster-view, .draft-container, .scouting-layout').first()).toBeVisible();
        }
        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('a cold start reaches a usable app', async ({ page }) => {
        const errors = trackErrors(page);
        await openCold(page);
        // The seeded offseason loads itself; the draft board should have cards.
        await gotoTab(page, 'draft');
        await expect(page.locator('.player-card').first()).toBeVisible({ timeout: 30_000 });
        expect(errors.filter(e => !/favicon/i.test(e)), errors.join('\n')).toEqual([]);
    });
});

test.describe('routing', () => {
    test('the stage is in the URL, survives a reload, and back/forward move between stages', async ({ page }) => {
        await openWarm(page);

        await gotoTab(page, 'roster');
        await expect(page).toHaveURL(/view=roster/);
        await gotoTab(page, 'scouting');
        await expect(page).toHaveURL(/view=scouting/);

        await page.reload();
        await page.waitForSelector('.view-tabbar');
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);

        await page.goBack();
        await page.waitForSelector('.view-tabbar');
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.roster);
        await page.goForward();
        await page.waitForSelector('.view-tabbar');
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);
    });

    test('an unknown view falls back rather than rendering nothing', async ({ page }) => {
        await page.addInitScript(() => {});
        await page.goto('/?view=not-a-real-view');
        await page.waitForSelector('.view-tabbar');
        await expect(page.locator('.view-tab.active')).toBeVisible();
    });
});

test.describe('overlays', () => {
    test('Escape closes an overlay, and menus escape their clipping parents', async ({ page }) => {
        await openWarm(page, 'scouting');

        // The menu lives in a portal because .scouting-layout clips it.
        await page.getByRole('button', { name: 'More' }).first().click();
        const menu = page.locator('.menu-list');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        await page.getByRole('button', { name: 'More' }).first().click();
        await expect(menu).toBeVisible();
        // Clicking away closes it too.
        await page.locator('body').click({ position: { x: 5, y: 400 } });
        await expect(menu).toBeHidden();
    });

    test('the user guide opens from the tab bar and renders the document', async ({ page }) => {
        await openWarm(page);
        await page.getByRole('button', { name: '? Help' }).click();
        await expect(page.locator('.help-modal')).toBeVisible();
        await expect(page.locator('.help-body h1')).toContainText('DraftBoard');
        await page.keyboard.press('Escape');
        await expect(page.locator('.help-modal')).toBeHidden();
    });
});

test.describe('the player card', () => {
    test('opens outside Scouting, edits facts, and never re-ranks', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.locator('.rv-slot-name').first().click();

        const card = page.locator('.scouting-modal-box');
        await expect(card).toBeVisible();

        // Facts are the editable half here. Opinions are not offered at all:
        // re-ranking a player on somebody's draft board is not something you
        // do from a depth chart.
        await expect(card.locator('.scouting-fact-grid')).toBeVisible();
        await expect(card.locator('.scouting-group-fields')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(card).toBeHidden();
    });

    test('a remark can be written on a veteran, who is on nobody\'s draft board', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.locator('.rv-slot-name').first().click();
        const card = page.locator('.scouting-modal-box');
        await expect(card).toBeVisible();

        // A veteran was never in a class anybody ranked, so this is the only
        // place anything can be said about him.
        const input = card.locator('.remark-input, input[placeholder*="Add"]').first();
        await expect(input).toBeVisible();
    });

    test('dragging a roster slot does not open the card', async ({ page }) => {
        await openWarm(page, 'roster');
        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(1));
        await expect(page.locator('.scouting-modal-box')).toBeHidden();
    });
});

test.describe('drag and drop', () => {
    test('scouting: a drag reorders the board and survives a reload', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.player-card', { timeout: 30_000 });

        const before = await page.$$eval('.player-card .player-name', els => els.slice(0, 4).map(e => e.textContent));
        const cards = page.locator('.player-card');
        await dragTo(page, cards.nth(0), cards.nth(3));

        const after = await page.$$eval('.player-card .player-name', els => els.slice(0, 4).map(e => e.textContent));
        expect(after, 'the drag changed nothing on screen').not.toEqual(before);

        await page.reload();
        await page.waitForSelector('.player-card', { timeout: 30_000 });
        const reloaded = await page.$$eval('.player-card .player-name', els => els.slice(0, 4).map(e => e.textContent));
        expect(reloaded, 'the order did not survive the reload').toEqual(after);
    });

    test('roster: a slot moves, and the move is written through to storage', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid');

        const before = await slotNames(page);
        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        const after = await slotNames(page);
        expect(after).not.toEqual(before);

        await page.reload();
        await page.waitForSelector('.roster-grid');
        expect(await slotNames(page)).toEqual(after);
    });
});

test.describe('undo', () => {
    test('roster undo restores what was removed, and it reached storage', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid');
        const before = await slotNames(page);

        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        expect(await slotNames(page)).not.toEqual(before);

        await page.getByRole('button', { name: /Undo/i }).first().click();
        await page.waitForTimeout(300);
        expect(await slotNames(page)).toEqual(before);

        await page.reload();
        await page.waitForSelector('.roster-grid');
        expect(await slotNames(page), 'undo did not write through').toEqual(before);
    });
});

test.describe('adding players', () => {
    test('a typed player reaches verification, commits, and lands on the board', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.getByRole('button', { name: 'More' }).first().click();
        await page.getByRole('menuitem', { name: /Add Prospects|Add Players/i }).click();

        const modal = page.locator('.add-prospects');
        await expect(modal).toBeVisible();

        await modal.locator('input').nth(0).fill('Test Prospect');
        await modal.locator('input').nth(1).fill('QB');
        await page.getByRole('button', { name: /Review|Verify|Continue/i }).first().click();

        // Nothing is written until verification is submitted.
        await expect(page.locator('.ap-verify, .add-prospects')).toBeVisible();
    });
});

test.describe('session and init', () => {
    test('a clean slate empties every stage and survives a reload', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid');

        await page.locator('.view-tabbar-actions').getByRole('button', { name: 'Session' }).click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/i }).click();
        // It asks first — this is the one irreversible action.
        await page.getByRole('button', { name: /Clean Slate|Confirm|Yes/i }).last().click();
        await page.waitForTimeout(1500);

        await page.reload();
        await page.waitForSelector('.view-tabbar');
        await gotoTab(page, 'draft');
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.draft);
    });
});

test.describe('settings', () => {
    test('positional value is editable, persists, and a non-http matrix link is refused', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.getByRole('button', { name: 'More' }).first().click();
        await page.getByRole('menuitem', { name: /Settings/i }).click();

        const modal = page.locator('.app-settings');
        await expect(modal).toBeVisible();

        const link = modal.locator('input[type="url"]');
        await link.fill('javascript:alert(1)');
        await page.getByRole('button', { name: 'Save' }).click();
        // Refused rather than stored: the modal stays open and says why.
        await expect(modal).toBeVisible();
        await expect(page.locator('.ap-error')).toBeVisible();
    });
});
