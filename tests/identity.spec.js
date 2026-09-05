import { test, expect } from '@playwright/test';
import { openApp, gotoTab } from './helpers.js';

// A player is a record with a stable id, not a name. These guard the property
// that makes that worth having: the id survives things the name does not.

// One document per player, in the repository's collection layout.
const REGISTRY = 'db_players';

const registry = (page) => page.evaluate((key) => {
    const docs = JSON.parse(localStorage.getItem(key) || '{}');
    return Object.values(docs);
}, REGISTRY);

const openScouting = async (page) => {
    await openApp(page, 'scouting');
    await page.waitForSelector('.scouting-rank-row');
    await expect.poll(() => registry(page).then(p => p.length), { timeout: 30000 })
        .toBeGreaterThan(100);
};

test.describe('player identity', () => {
    test('one record per player, and the ids survive a reload', async ({ page }) => {
        await openScouting(page);

        const first = await registry(page);
        const ids = first.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);

        // The registry holds every player the app has seen, which is more than
        // any one board's pool — roster veterans are registered too, from the
        // acquisition suffixes in roster.csv. A board is a subset of it.
        expect(first.length).toBeGreaterThanOrEqual(
            await page.locator('.scouting-rank-row').count(),
        );

        await page.reload();
        await page.waitForSelector('.scouting-rank-row');
        await page.waitForTimeout(1500);

        // Re-reading the rankings files must reuse the records, not mint a
        // second set for the same players.
        const second = await registry(page);
        expect(second.length).toBe(first.length);
        expect(second.map(p => p.id)).toEqual(ids);
    });

    test('evaluations are stored against the id, not the name', async ({ page }) => {
        await openScouting(page);

        await page.locator('.scouting-rank-row').first().locator('.scouting-rank-card').click();
        const panel = page.locator('.scouting-layout .right-panel');
        await panel.getByRole('button', { name: 'Like' }).click();
        await page.waitForTimeout(500);

        const entry = await page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem('scouting_overlay_v1__consensus') || '{}');
            return (s.entries || []).find(e => e.tag === 'like' && e.playerId);
        });
        expect(entry?.playerId).toBeTruthy();
    });

    test('a rename keeps the id, and the evaluation follows the player', async ({ page }) => {
        await openScouting(page);

        // Give a player something to lose, then rename him.
        const row = page.locator('.scouting-rank-row').first();
        const original = (await row.locator('.player-name').innerText()).trim();
        await row.locator('.scouting-rank-card').click();

        const panel = page.locator('.scouting-layout .right-panel');
        const strength = panel.locator('.scouting-list-field.strength .scouting-list-add input');
        await strength.fill('Follows the rename');
        await strength.press('Enter');
        await expect(panel.locator('.scouting-list-field.strength .scouting-remark-text'))
            .toHaveText(['Follows the rename']);

        const idBefore = await page.evaluate((name) => {
            const docs = JSON.parse(localStorage.getItem('db_players') || '{}');
            return Object.values(docs).find(p => p.name === name)?.id;
        }, original);
        expect(idBefore).toBeTruthy();

        await panel.getByRole('button', { name: 'Edit name, position and school' }).click();
        await panel.getByLabel('Name').fill('Renamed Entirely');
        await panel.getByRole('button', { name: 'Save' }).click();
        await page.waitForTimeout(900);

        await expect(panel).toContainText('Renamed Entirely');
        await expect(panel).toContainText('Follows the rename');

        // Same record, new name — not a second player.
        const after = await registry(page);
        const renamed = after.find(p => p.name === 'Renamed Entirely');
        expect(renamed?.id).toBe(idBefore);
        expect(after.filter(p => p.name === original)).toHaveLength(0);

        // And it holds across a reload, where the rankings file still supplies
        // the ORIGINAL name — the alias is what stops it becoming a duplicate.
        await page.reload();
        await page.waitForSelector('.scouting-rank-row');
        await page.waitForTimeout(2000);
        const reloaded = await registry(page);
        expect(reloaded.filter(p => p.id === idBefore)).toHaveLength(1);
    });

    test('a clean slate clears the registry and it rebuilds itself', async ({ page }) => {
        await openScouting(page);
        expect((await registry(page)).length).toBeGreaterThan(100);

        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/ }).click();
        await page.waitForTimeout(400);
        await page.locator('.rv-inline-dialog button.save-pill').click();
        await page.waitForTimeout(2500);

        // The rankings files are still there, so the records come straight
        // back — nothing in the registry is anything but re-derivable.
        await gotoTab(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');
        await expect.poll(() => registry(page).then(p => p.length), { timeout: 30000 })
            .toBeGreaterThan(100);
    });
});
