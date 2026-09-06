import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// A board is a snapshot and freezes; an evaluation is a running log and does
// not. These guard that split — remarks belong to the person who wrote them,
// carry the season they were written in, and outlive the board.

const remarks = (page) => page.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem('db_evaluations') || '{}'))
        .flatMap(d => d.remarks || []));

const openScouting = async (page) => {
    await openApp(page, 'scouting');
    await page.waitForSelector('.scouting-rank-row');
    await page.waitForTimeout(1200);
};

test.describe('evaluations', () => {
    test('a remark is stored against the author, stamped with the season', async ({ page }) => {
        await openScouting(page);

        await page.locator('.scouting-rank-row').first().locator('.scouting-rank-card').click();
        const panel = page.locator('.scouting-layout .right-panel');
        const input = panel.locator('.scouting-list-field.strength .scouting-list-add input');
        await input.fill('Bends the corner');
        await input.press('Enter');
        await page.waitForTimeout(600);

        const stored = await remarks(page);
        const mine = stored.find(r => r.text === 'Bends the corner');
        expect(mine).toBeTruthy();
        expect(mine.kind).toBe('strength');
        // Stamped, so it cannot later be mistaken for a current read.
        expect(mine.seasonId).toBeTruthy();

        // Shown under the season it belongs to — the year is read from the
        // season record rather than assumed.
        const year = await page.evaluate((id) => Object.values(
            JSON.parse(localStorage.getItem('db_seasons') || '{}'),
        ).find(x => x.id === id)?.year, mine.seasonId);
        expect(year).toBeTruthy();
        await expect(panel.locator('.scouting-list-field.strength .scouting-season-label').first())
            .toHaveText(String(year));
    });

    test('remarks do not live on the board entry any more', async ({ page }) => {
        await openScouting(page);

        await page.locator('.scouting-rank-row').first().locator('.scouting-rank-card').click();
        const input = page.locator('.scouting-layout .right-panel .scouting-list-field.note .scouting-list-add input');
        await input.fill('Off the board');
        await input.press('Enter');
        await page.waitForTimeout(600);

        // The board carries placement and tags. Nothing else.
        const onEntries = await page.evaluate(() => Object.keys(localStorage)
            .filter(k => k.startsWith('scouting_board_v1__'))
            .flatMap(k => JSON.parse(localStorage.getItem(k) || '{}').entries ?? [])
            .filter(e => 'strengths' in e || 'weaknesses' in e || 'notes' in e).length);
        expect(onEntries).toBe(0);
    });

    test('a remark survives a reload and reaches the export', async ({ page }) => {
        await openScouting(page);

        await page.locator('.scouting-rank-row').first().locator('.scouting-rank-card').click();
        const input = page.locator('.scouting-layout .right-panel .scouting-list-field.weakness .scouting-list-add input');
        await input.fill('Grabby in press');
        await input.press('Enter');
        await page.waitForTimeout(600);

        await page.reload();
        await page.waitForSelector('.scouting-rank-row');
        await page.waitForTimeout(1500);
        expect((await remarks(page)).some(r => r.text === 'Grabby in press')).toBe(true);

        // exportCSV reads from the evaluations store, not the entry — reading
        // it from the entry silently exported nothing.
        const dl = page.waitForEvent('download');
        await page.getByRole('button', { name: 'More ▾' }).click();
        await page.getByRole('menuitem', { name: /Export Scouting CSV/ }).click();
        const stream = await (await dl).createReadStream();
        let csv = '';
        for await (const chunk of stream) csv += chunk;
        expect(csv).toContain('Grabby in press');
    });
});
