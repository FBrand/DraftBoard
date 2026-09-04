import { test, expect } from '@playwright/test';
import { openApp, trackErrors } from './helpers.js';

test.describe('scouting', () => {
    test('every player is clickable and undimmed regardless of draft status', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        // Scouting builds boards independent of who's off the board in the
        // live draft, so no card should carry the greyed-out drafted styling.
        await expect(page.locator('.center-board-container .player-card.drafted')).toHaveCount(0);

        await page.locator('.center-board-container .player-card').first().click();
        await expect(page.locator('.scouting-layout .right-panel .scouting-controls-header')).toBeVisible();
    });

    test('evaluations are per board and do not leak between analysts', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        await page.locator('.center-board-container .player-card').first().click();
        const player = await page.locator('.scouting-controls-header strong').innerText();

        const notes = page.locator('.scouting-list-field').nth(2);
        await notes.locator('input').fill('Consensus note');
        await notes.getByRole('button', { name: '+' }).click();
        await page.waitForTimeout(300);

        await expect(page.locator('.scouting-board-pager span')).toHaveText(/CONSENSUS/i);

        // Page to the next analyst: same player, separate evaluation.
        await page.getByRole('button', { name: 'Next board' }).click();
        await page.waitForTimeout(300);
        await expect(page.locator('.scouting-board-pager span')).toHaveText(/DAN/i);
        await expect(page.locator('.scouting-controls-header strong')).toHaveText(player);
        await expect(page.locator('.scouting-list-field').nth(2).locator('.scouting-bullet-list li')).toHaveCount(0);

        // Back again: the original note is intact.
        await page.getByRole('button', { name: 'Previous board' }).click();
        await page.waitForTimeout(300);
        await expect(page.locator('.scouting-list-field').nth(2).locator('.scouting-bullet-list li span'))
            .toHaveText(['Consensus note']);
    });

    test('drag reorders My Board and persists across reload', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        const nameAt = async (i) => (await page.locator('.scouting-rank-row').nth(i)
            .locator('.scouting-rank-card').innerText()).split('\n').pop();
        const third = await nameAt(2);

        const handles = page.locator('.scouting-rank-handle');
        const from = await handles.nth(2).boundingBox();
        const to = await handles.nth(0).boundingBox();
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(80);
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
        await page.waitForTimeout(80);
        await page.mouse.up();
        await page.waitForTimeout(400);

        expect(await nameAt(0)).toBe(third);

        await page.reload();
        await page.waitForSelector('.scouting-rank-row');
        expect(await nameAt(0)).toBe(third);
    });

    test('board CSV export emits group,name,position', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        await page.locator('.center-board-container .player-card').first().click();
        await page.locator('.scouting-group-field input').fill('1.3');
        await page.locator('.scouting-group-field input').blur();
        await page.waitForTimeout(300);

        // The group badge shows on the ranked list
        await expect(page.locator('.scouting-rank-group').first()).toHaveText('1.3');

        await page.getByRole('button', { name: 'More ▾' }).click();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('menuitem', { name: /Export as Board CSV/ }).click(),
        ]);
        const stream = await download.createReadStream();
        const text = await new Promise(res => {
            let d = '';
            stream.on('data', c => { d += c; });
            stream.on('end', () => res(d));
        });

        const lines = text.trim().split('\n');
        expect(lines[0]).toBe('group,name,position');
        expect(lines[1]).toMatch(/^1\.3,/);
        expect(errors).toEqual([]);
    });
});
