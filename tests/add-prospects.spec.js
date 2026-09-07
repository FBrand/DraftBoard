import { test, expect } from '@playwright/test';
import { openApp, trackErrors } from './helpers.js';

// Adding a prospect is the one place the app writes BASE data — who exists,
// not what anyone thinks of him — so these guard two things: that a player
// typed here really joins the pool and ranks like any other, and that nothing
// is written until the verification step is submitted.

const openAdd = async (page) => {
    await openApp(page, 'scouting');
    await page.waitForSelector('.scouting-rank-card');
    await page.getByRole('button', { name: '+ Add Players' }).click();
    await expect(page.locator('.add-prospects')).toBeVisible();
};

const entryRow = (page, i) => page.locator('.ap-entry-grid input').nth(i * 3);

test.describe('adding prospects', () => {
    test('a typed player joins the board and every board', async ({ page }) => {
        const errors = trackErrors(page);
        await openAdd(page);

        const inputs = page.locator('.ap-entry-grid input');
        await inputs.nth(0).fill('Testy McProspect');
        await inputs.nth(1).fill('EDGE');
        await inputs.nth(2).fill('Test State');

        await page.getByRole('button', { name: /^Review/ }).click();
        await expect(page.locator('.ap-player')).toHaveCount(1);

        // Untouched enrichment fields are optional — submitting straight away
        // has to work, since that is the live-broadcast path.
        await page.getByRole('button', { name: /Add 1 to board/ }).click();
        await expect(page.locator('.add-prospects')).toHaveCount(0);

        await expect(page.locator('.scouting-rank-card', { hasText: 'Testy McProspect' })).toHaveCount(1);

        // Base data is shared, so he is on the other boards too.
        await page.getByRole('button', { name: 'Dan', exact: true }).click();
        await expect(page.locator('.scouting-rank-card', { hasText: 'Testy McProspect' })).toHaveCount(1);

        expect(errors).toEqual([]);
    });

    test('Enter walks the rows and an empty row moves on to verification', async ({ page }) => {
        await openAdd(page);

        await entryRow(page, 0).fill('Alpha One');
        await entryRow(page, 0).press('Enter');
        await expect(entryRow(page, 1)).toBeFocused();

        await entryRow(page, 1).fill('Beta Two');
        await entryRow(page, 1).press('Enter');
        await expect(entryRow(page, 2)).toBeFocused();

        // Enter on a row nothing was typed into ends entry.
        await entryRow(page, 2).press('Enter');
        await expect(page.locator('.ap-player')).toHaveCount(2);
    });

    test('a name already on the board blocks the submit until resolved', async ({ page }) => {
        await openAdd(page);

        const existing = await page.locator('.scouting-rank-card .player-name').first().textContent()
            .catch(() => null);
        const name = existing?.trim() || 'Ty Simpson';

        await entryRow(page, 0).fill(name);
        await page.getByRole('button', { name: /^Review/ }).click();

        await expect(page.locator('.ap-player.blocked')).toHaveCount(1);
        await expect(page.locator('.ap-collision')).toBeVisible();
        await expect(page.getByRole('button', { name: /to board$/ })).toBeDisabled();

        // A collision is never a dead end: it offers the player who is
        // already there.
        await expect(page.locator('.ap-link').first()).toBeVisible();
    });

    test('verification commits nothing if it is cancelled', async ({ page }) => {
        await openAdd(page);

        await entryRow(page, 0).fill('Abandoned Prospect');
        await entryRow(page, 0).press('Enter');
        await entryRow(page, 1).press('Enter');
        await expect(page.locator('.ap-player')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(page.locator('.add-prospects')).toHaveCount(0);
        await expect(page.locator('.scouting-rank-card', { hasText: 'Abandoned Prospect' })).toHaveCount(0);

        await page.reload();
        await page.waitForSelector('.scouting-rank-card');
        await expect(page.locator('.scouting-rank-card', { hasText: 'Abandoned Prospect' })).toHaveCount(0);
    });

    test('an added player carries his tier, tag and remarks onto the board', async ({ page }) => {
        await openAdd(page);

        await entryRow(page, 0).fill('Tiered Prospect');
        await page.locator('.ap-entry-grid input').nth(1).fill('WR');
        await page.getByRole('button', { name: /^Review/ }).click();

        const card = page.locator('.ap-player').first();
        await card.locator('.ap-num input').nth(0).fill('1');   // round
        await card.locator('.ap-num input').nth(1).fill('2');   // tier
        await card.locator('.ap-tag-btn').first().click();      // like
        await card.getByRole('button', { name: 'Add strength' }).click();
        await card.locator('.ap-bullet.strength input').fill('Separates late');

        await page.getByRole('button', { name: /Add 1 to board/ }).click();
        await expect(page.locator('.add-prospects')).toHaveCount(0);

        // He lands in the tier he was given, not in the untiered bucket.
        const boardCard = page.locator('.player-card', { hasText: 'Tiered Prospect' }).first();
        await expect(boardCard).toBeVisible();

        await boardCard.click();
        await expect(page.locator('.scouting-layout .right-panel')).toContainText('Separates late');
    });
});

test.describe('editing a player', () => {
    test('base data can be corrected, and a correction follows the board entry', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-card');
        await page.getByRole('button', { name: '+ Add Players' }).click();

        const inputs = page.locator('.ap-entry-grid input');
        await inputs.nth(0).fill('Mishherd Name');
        await inputs.nth(1).fill('TE');
        await inputs.nth(2).fill('Wrong School');
        await page.getByRole('button', { name: /^Review/ }).click();
        await page.getByRole('button', { name: /Add 1 to board/ }).click();

        await page.locator('.scouting-rank-card', { hasText: 'Mishherd Name' }).click();
        const panel = page.locator('.scouting-layout .right-panel');

        await panel.getByRole('button', { name: 'Edit name, position and school' }).click();
        await panel.getByLabel('Name').fill('Misheard Name');
        await panel.getByLabel('School').fill('Right School');
        await panel.getByRole('button', { name: 'Save' }).click();

        await expect(panel).toContainText('Misheard Name');
        await expect(panel).toContainText('Right School');
        await expect(page.locator('.scouting-rank-card', { hasText: 'Misheard Name' })).toHaveCount(1);

        await page.reload();
        await page.waitForSelector('.scouting-rank-card');
        await expect(page.locator('.scouting-rank-card', { hasText: 'Misheard Name' })).toHaveCount(1);
        await expect(page.locator('.scouting-rank-card', { hasText: 'Mishherd Name' })).toHaveCount(0);
    });

    test('a player can be removed, and stays removed', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-card');

        // Any player at all — where he came from is not supposed to matter.
        const first = page.locator('.scouting-rank-card').first();
        const name = (await first.locator('.player-name').textContent()).trim();
        await first.click();

        const panel = page.locator('.scouting-layout .right-panel');
        await panel.getByRole('button', { name: 'Remove player' }).click();
        await panel.getByRole('button', { name: 'Remove', exact: true }).click();

        await expect(page.locator('.scouting-rank-card', { hasText: name })).toHaveCount(0);

        await page.reload();
        await page.waitForSelector('.scouting-rank-card');
        await expect(page.locator('.scouting-rank-card', { hasText: name })).toHaveCount(0);
    });

    test('two players can share a name at different positions', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-card');
        await page.getByRole('button', { name: '+ Add Players' }).click();

        const inputs = page.locator('.ap-entry-grid input');
        await inputs.nth(0).fill('Same Name');
        await inputs.nth(1).fill('WR');
        await inputs.nth(3).fill('Same Name');
        await inputs.nth(4).fill('CB');
        await page.getByRole('button', { name: /^Review/ }).click();

        // Same name, different position — two different men, not a duplicate.
        await expect(page.locator('.ap-player.blocked')).toHaveCount(0);
        await page.getByRole('button', { name: /Add 2 to board/ }).click();

        await expect(page.locator('.scouting-rank-card', { hasText: 'Same Name' })).toHaveCount(2);
    });

    test('the same name at the same position is still blocked', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-card');
        await page.getByRole('button', { name: '+ Add Players' }).click();

        const inputs = page.locator('.ap-entry-grid input');
        await inputs.nth(0).fill('Twin Entry');
        await inputs.nth(1).fill('WR');
        await inputs.nth(3).fill('Twin Entry');
        await inputs.nth(4).fill('WR');
        await page.getByRole('button', { name: /^Review/ }).click();

        await expect(page.locator('.ap-player.blocked')).toHaveCount(1);
        await expect(page.getByRole('button', { name: /to board$/ })).toBeDisabled();
    });

    test('reopening Add Players starts a fresh batch', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-card');

        await page.getByRole('button', { name: '+ Add Players' }).click();
        await page.locator('.ap-entry-grid input').first().fill('First Batch');
        await page.getByRole('button', { name: /^Review/ }).click();
        await page.getByRole('button', { name: /Add 1 to board/ }).click();

        // It used to come back up on the verification step it was left on,
        // with the previous batch still in it.
        await page.getByRole('button', { name: '+ Add Players' }).click();
        await expect(page.locator('.ap-entry-grid')).toBeVisible();
        await expect(page.locator('.ap-player')).toHaveCount(0);
        await expect(page.locator('.ap-entry-grid input').first()).toHaveValue('');
    });

    test('the Unranked filter shows only players nobody has placed', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-card');

        await page.getByRole('button', { name: '+ Add Players' }).click();
        await page.locator('.ap-entry-grid input').nth(0).fill('Unplaced Guy');
        await page.locator('.ap-entry-grid input').nth(1).fill('LB');
        await page.getByRole('button', { name: /^Review/ }).click();
        await page.getByRole('button', { name: /Add 1 to board/ }).click();

        const before = await page.locator('.center-board-container .player-card').count();
        await page.getByRole('button', { name: 'Unranked', exact: true }).click();

        const cards = page.locator('.center-board-container .player-card');
        await expect(cards.filter({ hasText: 'Unplaced Guy' })).toHaveCount(1);

        // Only unranked players survive the filter, and they all sit in the
        // UR row rather than being scattered through the rounds.
        const shown = await cards.count();
        expect(shown).toBeLessThan(before);
        await expect(page.locator('.round-sidebar-label', { hasText: 'UR' })).toHaveCount(1);
        expect(await page.locator('.board-row').count()).toBe(1);
    });
});
