import { test, expect } from '@playwright/test';
import { openApp, gotoTab, ensureRoster, trackErrors, dragTo } from './helpers.js';

test.describe('player info card', () => {
    test('right-click on the draft board opens a read-only card', async ({ page }) => {
        await openApp(page, 'draft');
        await page.waitForTimeout(600);

        const card = page.locator('.center-board-container .player-card').first();
        const wasAvailable = await card.evaluate(el => el.className.includes('available'));
        await card.click({ button: 'right' });

        const box = page.locator('.scouting-modal-box');
        await expect(box).toBeVisible();

        // Read-only: no inputs at all, and Round.Group is not shown here
        // (it's a board-building control, not a scouting read-out).
        await expect(box.locator('input')).toHaveCount(0);
        await expect(box.locator('.scouting-group-field')).toHaveCount(0);

        // Unset numbers read as "?" rather than disappearing.
        const values = await box.locator('.scouting-readonly-value').allTextContents();
        expect(values).toHaveLength(4);
        expect(values.every(v => v.trim() === '?')).toBe(true);

        // Opening the card must not draft the player.
        if (wasAvailable) {
            expect(await card.evaluate(el => el.className.includes('available'))).toBe(true);
        }
    });

    test('Escape closes the card', async ({ page }) => {
        await openApp(page, 'draft');
        await page.waitForTimeout(600);
        await page.locator('.center-board-container .player-card').first().click({ button: 'right' });
        await expect(page.locator('.scouting-modal-box')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.scouting-modal-box')).toHaveCount(0);
    });

    test('roster slots open the card on click and on right-click', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        await page.locator('.rv-slot.filled').first().click();
        await expect(page.locator('.scouting-modal-box')).toBeVisible();
        await expect(page.locator('.scouting-modal-box input')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await page.locator('.rv-slot.filled').first().click({ button: 'right' });
        await expect(page.locator('.scouting-modal-box')).toBeVisible();
    });

    test('dragging a roster slot does not open the card', async ({ page }) => {
        // The card opens on plain click here (dnd-kit owns press-and-hold), so
        // a real drag must not also trigger it.
        await openApp(page);
        await ensureRoster(page);

        await dragTo(page,
            page.locator('.rv-slot.filled').first(),
            page.locator('.roster-cuts'));

        await expect(page.locator('.scouting-modal-box')).toHaveCount(0);
    });

    test('free agency candidates open the card', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);
        await ensureRoster(page);
        await gotoTab(page, 'fa');

        // FA starts empty; give it a row and a candidate.
        await page.getByRole('button', { name: 'More ▾' }).click();
        await page.getByRole('menuitem', { name: 'Import Positions from Roster' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: '+ Add Candidate' }).click();
        await page.locator('.modal-content input').first().fill('Freddy Agent');
        await page.locator('.modal-content input').nth(1).fill('WR');
        await page.locator('.modal-content button.save-pill').click();
        await page.waitForTimeout(400);

        await page.locator('.rv-slot.filled').first().click();
        await expect(page.locator('.scouting-modal-box')).toBeVisible();
        await expect(page.locator('.scouting-modal-box input')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
});
