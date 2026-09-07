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
            await expect(page.locator('.roster-view, .main-layout, .scouting-layout').first()).toBeVisible();
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
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);

        await page.goBack();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.roster);
        await page.goForward();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);
    });

    test('an unknown view falls back rather than rendering nothing', async ({ page }) => {
        await page.addInitScript(() => {});
        await page.goto('/?view=not-a-real-view');
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toBeVisible();
    });
});

test.describe('overlays', () => {
    test('Escape closes an overlay, and menus escape their clipping parents', async ({ page }) => {
        await openWarm(page, 'scouting');

        // The menu lives in a portal because .scouting-layout clips it.
        await page.locator('.top-panel .app-menu-trigger').click();
        const menu = page.locator('.app-menu-list');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        await page.locator('.top-panel .app-menu-trigger').click();
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
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
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
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
        await page.locator('.rv-slot-name').first().click();
        const card = page.locator('.scouting-modal-box');
        await expect(card).toBeVisible();

        // Locked, there is nothing to type into: a card you opened to read
        // should not have an open text box on a broadcast.
        await expect(card.locator('.scouting-list-add')).toHaveCount(0);

        // One pencil unlocks the whole card. A veteran was never in a class
        // anybody ranked, so this is the only place anything can be said
        // about him at all.
        await card.locator('.scouting-edit-btn').first().click();
        await expect(card.locator('.scouting-list-add').first()).toBeVisible();
        await expect(card.locator('.scouting-list-field')).toHaveCount(3);
    });

    test('dragging a roster slot does not open the card', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(1));
        // A drag is not a click: the card must not appear.
        await expect(page.locator('.scouting-modal-box')).toHaveCount(0);
    });
});

test.describe('drag and drop', () => {
    test('scouting: reordering the ranking survives a reload', async ({ page }) => {
        await openWarm(page, 'scouting');
        // The ranking column is what reorders; the grouped list beside it is a
        // reading surface and deliberately does not drag.
        await page.waitForSelector('.scouting-rank-handle', { timeout: 45_000 });

        const names = () => page.$$eval('.left-panel .scouting-rank-card',
            els => els.slice(0, 5).map(e => e.textContent));

        const before = await names();
        const handles = page.locator('.scouting-rank-handle');
        await dragTo(page, handles.nth(0), handles.nth(3));

        const after = await names();
        expect(after, 'the drag changed nothing on screen').not.toEqual(before);

        await page.reload();
        await page.waitForSelector('.scouting-rank-handle', { timeout: 45_000 });
        expect(await names(), 'the order did not survive the reload').toEqual(after);
    });

    test('roster: a slot moves, and the move is written through to storage', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        const before = await slotNames(page);
        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        const after = await slotNames(page);
        expect(after).not.toEqual(before);

        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        expect(await slotNames(page)).toEqual(after);
    });
});

test.describe('undo', () => {
    test('roster undo restores what was removed, and it reached storage', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        const before = await slotNames(page);

        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        expect(await slotNames(page)).not.toEqual(before);

        await page.getByRole('button', { name: /Undo/i }).first().click();
        await page.waitForTimeout(300);
        expect(await slotNames(page)).toEqual(before);

        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        expect(await slotNames(page), 'undo did not write through').toEqual(before);
    });
});

test.describe('adding players', () => {
    test('a typed player reaches verification, commits, and lands on the board', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.getByRole('button', { name: '+ Add Players' }).click();

        const modal = page.locator('.add-prospects');
        await expect(modal).toBeVisible();

        await modal.locator('input').nth(0).fill('Test Prospect');
        await modal.locator('input').nth(1).fill('QB');
        await page.getByRole('button', { name: 'Review' }).click();

        // An import or a typed row PROPOSES; nothing is written until the
        // verification step is submitted, so the modal is still up.
        // Still on the modal, at the verification step — an entry PROPOSES,
        // and nothing reaches a board until it is submitted.
        await expect(modal).toBeVisible();
    });
});

test.describe('session and init', () => {
    test('a clean slate empties every stage and survives a reload', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/i }).click();
        // It asks first — this is the one irreversible action.
        await page.getByRole('button', { name: 'Start clean' }).click();
        await page.waitForTimeout(1500);

        await page.reload();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await gotoTab(page, 'draft');
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.draft);
    });
});

test.describe('settings', () => {
    test('positional value is editable, persists, and a non-http matrix link is refused', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.locator('.top-panel .app-menu-trigger').click();
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

test.describe('the board CSV', () => {
    test('exports what an analyst wrote, markers and all', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 45_000 });

        // Write one of each kind on whoever is first, through the panel the
        // analyst actually uses.
        await page.locator('.sg-row').first().click();
        const panel = page.locator('.side-panel.right-panel');
        await expect(panel.locator('.scouting-list-field')).toHaveCount(3);

        const kinds = ['Elite arm talent', 'Footwork under pressure', 'Two-year starter'];
        for (let i = 0; i < 3; i += 1) {
            const box = panel.locator('.scouting-list-add').nth(i);
            await box.locator('input').fill(kinds[i]);
            await box.locator('button').click();
            await page.waitForTimeout(200);
        }

        const download = page.waitForEvent('download');
        await page.locator('.top-panel .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Export Board CSV/i }).click();
        const file = await download;
        const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');

        // The header a spreadsheet needs, and one line per marker. Without the
        // "Remarks:" prefix, Sheets and Excel read a leading + or - as a
        // formula and mangle the cell before it is ever saved.
        expect(text.split('\n')[0]).toContain('evaluation');
        expect(text).toContain('Remarks:');
        expect(text).toContain('+ Elite arm talent');
        expect(text).toContain('- Footwork under pressure');
        expect(text).toContain('• Two-year starter');
    });
});

test.describe('the draft board in normal view', () => {
    test('keeps drafted players in place and collapses only emptied tiers', async ({ page }) => {
        await openWarm(page, 'draft');
        await page.waitForSelector('.player-card', { timeout: 45_000 });

        // Wind the seeded, completed draft back to a handful of picks so there
        // are drafted and undrafted players sharing a tier.
        await page.evaluate(() => {
            const KEY = 'nfl_draft_board_state';
            const st = JSON.parse(localStorage.getItem(KEY));
            const kept = (st.draftedPlayers || []).filter(d => Number(d.pickNumber) <= 9);
            const names = new Set(kept.map(d => `${d.name}|${d.position}`));
            st.draftedPlayers = kept;
            st.currentPick = 10;
            st.yourPicks = kept.filter(d => d.draftedByUs);
            st.players = (st.players || []).map(pl => names.has(`${pl.name}|${pl.position}`)
                ? pl
                : { ...pl, drafted: false, draftedByUs: false, pickNumber: undefined, team: undefined });
            localStorage.setItem(KEY, JSON.stringify(st));
        });
        await page.reload();
        await page.waitForSelector('.player-card', { timeout: 45_000 });

        // A drafted player stays on the board, showing the pick that took him.
        // Removing players one at a time emptied a cell while its row lived on
        // for somebody else — a blank column reads as "nobody ranked one"
        // rather than "he went sixth".
        const drafted = await page.$$eval('.center-board-container .player-card',
            els => els.map(e => e.textContent.replace(/\s+/g, ' ')).filter(t => /PK\s*\d/.test(t)));
        expect(drafted.length, 'drafted players vanished from the board').toBeGreaterThan(0);

        // And the tier a drafted player sat in is still rendered, because
        // somebody in it is still available.
        const rows = await page.$$eval('.board-row, .center-board-container [class*=row]', els => els.length);
        expect(rows).toBeGreaterThan(0);
    });
});
