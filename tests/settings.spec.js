import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Positional value decides the order of players nobody has placed, which makes
// it an opinion — and it is shared by every board, so changing it has to reach
// boards that are already on screen.

const openSettings = async (page) => {
    await openApp(page, 'scouting');
    await page.waitForSelector('.scouting-rank-row');
    await page.locator('.scouting-layout').waitFor();
    await page.getByRole('button', { name: 'More ▾' }).click();
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    await expect(page.locator('.app-settings')).toBeVisible();
};

test.describe('settings', () => {
    test('positional value is editable and reaches the board', async ({ page }) => {
        await openSettings(page);

        const positions = page.locator('.settings-textarea');
        const shipped = await positions.inputValue();
        expect(shipped).toContain('QB');

        // Reverse it, so the tiebreak that used to favour quarterbacks now
        // favours whatever was last.
        const reversed = shipped.split(',').map(s => s.trim()).reverse().join(', ');
        await positions.fill(reversed);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('.app-settings')).toHaveCount(0);

        await page.reload();
        await page.waitForSelector('.scouting-rank-row');
        await page.getByRole('button', { name: 'More ▾' }).click();
        await page.getByRole('menuitem', { name: /Settings/ }).click();
        expect((await page.locator('.settings-textarea').inputValue()).trim())
            .toBe(reversed);
    });

    test('the shipped order can be restored', async ({ page }) => {
        await openSettings(page);

        const positions = page.locator('.settings-textarea');
        await positions.fill('RB, QB');
        await page.getByRole('button', { name: /Reset to the shipped order/ }).click();
        expect(await positions.inputValue()).toContain('QB, EDGE');
    });

    test('a link that is not http is refused rather than stored', async ({ page }) => {
        await openSettings(page);

        // These end up in an href, so anything but http(s) is a script
        // injection dressed up as configuration.
        await page.locator('input[type="url"]').fill('javascript:alert(1)');
        await page.getByRole('button', { name: 'Save', exact: true }).click();

        await expect(page.locator('.ap-error')).toBeVisible();
        await expect(page.locator('.app-settings')).toBeVisible();

        const stored = await page.evaluate(() => localStorage.getItem('athletic_matrix_url'));
        expect(stored ?? '').not.toContain('javascript:');
    });

    test('a valid link is kept', async ({ page }) => {
        await openSettings(page);

        await page.locator('input[type="url"]').fill('https://example.com/matrix');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('.app-settings')).toHaveCount(0);

        expect(await page.evaluate(() => localStorage.getItem('athletic_matrix_url')))
            .toContain('example.com/matrix');
    });
});
