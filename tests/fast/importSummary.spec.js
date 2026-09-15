import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * Starting a board from a CSV says what it did.
 *
 * A row naming somebody no rankings file has ever mentioned is stored as an
 * entry and then never rendered: the pool is built from the shipped files plus
 * in-app prospects, the uploaded file is not kept, and an entry whose player is
 * not in the pool has nothing to attach to.
 *
 * That is defensible — registering strangers straight from a CSV would walk
 * around the verification step Add Players insists on — but it was happening in
 * SILENCE. ScoutingView had carried the cure for this the whole time: an
 * `importSummary` state, a banner rendered for it, and the comment "An import
 * that replaces a board should say what it did — silence here reads as
 * 'nothing happened' when the file was wrong." `setImportSummary` was never
 * called with a value anywhere in the codebase, so the banner could not appear.
 */
test('scouting: creating a board from a CSV reports what it kept and what it could not show', async ({ page }) => {
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 45_000 });

    const csv = [
        'group,name,position',
        '1.1,Fernando Mendoza,QB',
        '1.2,Arvell Reese,EDGE',
        '2.1,Completely Unknown Person,WR',
    ].join('\n');

    await page.locator('button').filter({ hasText: /^More/ }).first().click();
    await page.locator('[role="menuitem"], .app-menu-item').filter({ hasText: /New Board/i }).first().click();
    await page.locator('.modal-overlay input.text-input, [role="dialog"] input').first().fill('Summary Test');
    await page.locator('.modal-overlay input[type="file"], [role="dialog"] input[type="file"]')
        .first().setInputFiles({ name: 'board.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.locator('button').filter({ hasText: /^Create Board$/ }).first().click();

    const banner = page.locator('.import-summary');
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // Two of the three are players the class knows.
    await expect(banner).toContainText('2');
    // And the third is named as kept-but-unshowable rather than dropped quietly.
    await expect(banner).toContainText(/not on any board/i);
});
