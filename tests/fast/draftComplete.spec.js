import { test, expect } from '@playwright/test';
import { openWarm } from './helpers.js';

/**
 * What the headline says once the last pick is in.
 *
 * The counter runs one past the final selection, and the header went on
 * announcing it — "NOW DRAFTING #258" on a draft that ends at 257. Everything
 * else in the view had already switched over: a card click signs a UDFA, the
 * board is in post-draft mode, the tracker reads "none left". Only the biggest
 * text on the screen still claimed a pick was on the clock, which is the line
 * a broadcast puts on air.
 */
test('a finished draft does not announce a pick that cannot happen', async ({ page }) => {
    await openWarm(page, 'draft');

    const label = page.locator('.pick-label').first();
    const number = page.locator('.pick-number').first();
    await expect(label).toBeVisible();

    const shown = await number.textContent();
    if (shown.trim() === 'UDFA') {
        // The seeded state is the completed 2026 draft, which is the case
        // this test exists for.
        await expect(label).toHaveText('DRAFT COMPLETE');
        await expect(page.locator('.our-pick-badge')).toHaveCount(0);
    } else {
        // A draft still running must still say so, or the fix traded one
        // wrong headline for another.
        await expect(label).not.toHaveText('DRAFT COMPLETE');
        expect(shown).toMatch(/^#\d+$/);
    }
});
