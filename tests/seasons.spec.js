import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Boards, authors and seasons are records with ids. The point of that is what
// survives a rename — so these guard the survival, not the plumbing.

const store = (page, key) => page.evaluate(k =>
    Object.values(JSON.parse(localStorage.getItem(k) || '{}')), key);

const openScouting = async (page) => {
    await openApp(page, 'scouting');
    await page.waitForSelector('.scouting-rank-row');
    await expect.poll(() => store(page, 'db_boards').then(b => b.length), { timeout: 30000 })
        .toBeGreaterThan(0);
};

test.describe('board identity', () => {
    test('boards have ids, and only the personal ones have an author', async ({ page }) => {
        await openScouting(page);

        const boards = await store(page, 'db_boards');
        expect(boards.length).toBeGreaterThanOrEqual(3);
        expect(new Set(boards.map(b => b.id)).size).toBe(boards.length);

        // Consensus is derived rather than written by a person. Inventing
        // somebody to own it would make "who said this" a lie.
        const consensus = boards.find(b => b.slug === 'consensus');
        expect(consensus.authorId).toBeNull();
        expect(boards.filter(b => b.slug !== 'consensus').every(b => b.authorId)).toBe(true);

        // One season, and it is the one being worked.
        const seasons = await store(page, 'db_seasons');
        expect(seasons.filter(s => s.status === 'current')).toHaveLength(1);
    });

    test('renaming a board keeps its work and its links', async ({ page }) => {
        await openScouting(page);

        // Put something on Dan's board so there is work to lose.
        await page.locator('.switcher-btn', { hasText: 'Dan' }).click();
        await page.waitForTimeout(600);
        await page.locator('.scouting-rank-row').first().locator('.scouting-rank-card').click();
        const panel = page.locator('.scouting-layout .right-panel');
        await panel.getByRole('button', { name: 'Like' }).click();
        await page.waitForTimeout(500);

        const before = await page.evaluate(() => {
            const boards = Object.values(JSON.parse(localStorage.getItem('db_boards') || '{}'));
            const dan = boards.find(b => b.slug === 'dan');
            const s = JSON.parse(localStorage.getItem('scouting_board_v1__' + dan.id) || '{}');
            return { id: dan.id, tagged: (s.entries || []).filter(e => e.tag).length };
        });
        expect(before.tagged).toBeGreaterThan(0);

        await page.locator('.switcher-btn', { hasText: 'Dan' }).dblclick();
        const dialog = page.locator('.rv-inline-dialog');
        await expect(dialog).toBeVisible();
        await dialog.locator('input').fill('Daniel Hamrs');
        await dialog.getByRole('button', { name: /Rename/ }).click();
        await page.waitForTimeout(600);

        await expect(page.locator('.switcher-btn', { hasText: 'Daniel Hamrs' })).toBeVisible();

        // Same board, same storage key, same work — the label was only a label.
        const after = await page.evaluate((id) => {
            const boards = Object.values(JSON.parse(localStorage.getItem('db_boards') || '{}'));
            const b = boards.find(x => x.id === id);
            const s = JSON.parse(localStorage.getItem('scouting_board_v1__' + id) || '{}');
            return { label: b?.label, slug: b?.slug, tagged: (s.entries || []).filter(e => e.tag).length };
        }, before.id);
        expect(after.label).toBe('Daniel Hamrs');
        expect(after.tagged).toBe(before.tagged);

        // The slug is untouched, so a link somebody already sent still works.
        expect(after.slug).toBe('dan');
        await page.goto('/?view=scouting&board=dan');
        await page.waitForSelector('.scouting-rank-row');
        await expect(page.locator('.switcher-btn.active')).toHaveText('Daniel Hamrs');
    });
});
