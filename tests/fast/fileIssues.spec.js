import { test, expect } from '@playwright/test';
import { openCold } from './helpers.js';

/**
 * A rankings file that rates the same man twice.
 *
 * rankings_dan.csv really did list Jakobe Thomas at 3.4 and again at 5.3. The
 * app resolved it by line order and said nothing, so the board looked like the
 * file had made one call. Cold boot, because the duplicate is only visible
 * while the files are being read.
 */
test('a file that rates a player twice says so', async ({ page }) => {
    await page.route('**/rankings_dan.csv', async (route) => {
        const res = await route.fetch();
        const body = await res.text();
        const lines = body.split('\n');
        // Put him back in a second time, at a tier the first row disagrees with.
        const i = lines.findIndex(l => /^[0-9]/.test(l) && l.split(',').length > 2);
        const dup = lines[i].split(',');
        dup[0] = '5.3';
        await route.fulfill({ body: [...lines, dup.join(',')].join('\n'), contentType: 'text/csv' });
    });

    await openCold(page, 'scouting');
    const banner = page.locator('.sg-file-issues');
    await expect(banner).toBeVisible({ timeout: 30000 });
    await expect(banner).toContainText('rates');
    await expect(banner).toContainText('The first is used.');
});
