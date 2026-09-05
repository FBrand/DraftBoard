import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApp, gotoTab, ensureRoster, trackErrors, STORAGE_KEYS } from './helpers.js';

const tmp = mkdtempSync(join(tmpdir(), 'db-session-'));

async function openSessionMenu(page) {
    await page.locator('.view-tabbar-actions .app-menu-trigger').click();
}

test.describe('full app session', () => {
    test('exports every stage and restores it after a wipe', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);

        // Seed distinctive state in two different stages.
        await ensureRoster(page);
        await gotoTab(page, 'scouting');
        await page.waitForSelector('.scouting-layout');
        await page.locator('.center-board-container .player-card').first().click();
        const player = await page.locator('.scouting-controls-header strong').innerText();
        const notes = page.locator('.scouting-list-field').nth(2);
        await notes.locator('input').fill('SESSION MARKER');
        await notes.getByRole('button', { name: '+' }).click();
        await page.waitForTimeout(300);

        // Export
        await openSessionMenu(page);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('menuitem', { name: /Export Full Session/ }).click(),
        ]);
        const file = join(tmp, 'session.json');
        await download.saveAs(file);

        const bundle = JSON.parse(readFileSync(file, 'utf-8'));
        expect(bundle.format).toBe('draftboard-session');
        expect(bundle.version).toBe(1);
        expect(Object.keys(bundle.data)).toEqual(
            expect.arrayContaining([STORAGE_KEYS.roster, STORAGE_KEYS.scoutingConsensus]));

        // Wipe everything
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForSelector('.view-tabbar');
        expect(await page.evaluate(k => localStorage.getItem(k), STORAGE_KEYS.roster)).toBeNull();

        // Restore
        await openSessionMenu(page);
        await page.setInputFiles('.app-menu-list input[type=file]', file);
        await page.waitForTimeout(400);
        // Destructive, so it confirms first.
        await expect(page.locator('.rv-inline-dialog')).toBeVisible();
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500); // the app reloads to re-seed every stage

        // Roster came back...
        await gotoTab(page, 'roster');
        await expect(page.locator('.roster-grid').first()).toBeVisible();

        // ...and so did the scouting note. It only renders once its player is
        // selected again, so re-select before asserting.
        await gotoTab(page, 'scouting');
        await page.waitForSelector('.scouting-layout');
        await page.locator('.center-board-container .player-card').first().click();
        await expect(page.locator('.scouting-controls-header strong')).toHaveText(player);
        await expect(page.locator('.scouting-list-field').nth(2).locator('.scouting-bullet-list li .scouting-remark-text'))
            .toHaveText(['SESSION MARKER']);

        expect(errors).toEqual([]);
    });

    test('rejects a non-session file without destroying current state', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        const bogus = join(tmp, 'bogus.json');
        writeFileSync(bogus, JSON.stringify({ hello: 'world' }));

        await openSessionMenu(page);
        await page.setInputFiles('.app-menu-list input[type=file]', bogus);
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(600);

        await expect(page.locator('.app-toast')).toContainText('Not a DraftBoard session file');
        // Import validates before writing, so the existing roster survives.
        await gotoTab(page, 'roster');
        await expect(page.locator('.roster-grid').first()).toBeVisible();
    });

    test('per-view CSV exports still exist alongside the global one', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        await page.locator('.top-actions .app-menu-trigger').click();
        await expect(page.getByRole('menuitem', { name: /Export Roster CSV/ })).toBeVisible();
        await page.keyboard.press('Escape');

        await gotoTab(page, 'scouting');
        await page.locator('.top-actions .app-menu-trigger').click();
        await expect(page.getByRole('menuitem', { name: /Export Scouting CSV/ })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /Import Scouting CSV/ })).toBeVisible();
    });
});
