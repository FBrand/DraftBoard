import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * A dialog must never be taller than the screen with no way down.
 *
 * The overlay CENTRES its box, so a dialog taller than the viewport hangs off
 * both ends at once — and `.modal-content` carried `overflow: hidden` and no
 * max-height, so nothing could scroll to what was hanging off. Measured on a
 * 390x844 phone: the Add Candidate dialog came to 1046px with "Add as Trade
 * Target" already off the bottom when it opened, and 1161px once a known name
 * brought up the "already known" list, which put BOTH actions off. The primary
 * action sat at bottom=901 and stayed there through every scroll a finger can
 * perform.
 *
 * Note the trap this nearly fell into: an end-to-end probe PASSED on the
 * broken build, because `scrollIntoViewIfNeeded` scrolls by means a person does
 * not have. The assertion has to be about reachability WITHOUT that.
 */
test('a dialog taller than the screen can still be scrolled to its actions', async ({ page }) => {
    await openWarm(page, 'fa');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    await page.locator('button').filter({ hasText: /Add Candidate/i }).first().click();
    await page.waitForSelector('.modal-content', { timeout: 20_000 });
    // A name the app already knows, which is what makes the dialog grow.
    await page.locator('.modal-content input').first().fill('Fernando Mendoza');
    await page.waitForTimeout(1_200);

    const fits = await page.evaluate(() => {
        const m = document.querySelector('.modal-content');
        const r = m.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, vh: window.innerHeight,
                 canScroll: m.scrollHeight > m.clientHeight + 1 };
    });
    expect(fits.top, 'the dialog hangs off the top of the screen').toBeGreaterThanOrEqual(-1);
    expect(fits.bottom, 'the dialog hangs off the bottom of the screen').toBeLessThanOrEqual(fits.vh + 1);

    // Reachable by scrolling the dialog itself — no scrollIntoViewIfNeeded.
    const reachable = await page.evaluate(() => {
        const m = document.querySelector('.modal-content');
        const b = m.querySelector('.modal-actions button.primary, .modal-actions button.action-button.primary');
        if (!b) return { found: false };
        m.scrollTop = m.scrollHeight;
        const r = b.getBoundingClientRect();
        return { found: true, inView: r.bottom <= window.innerHeight + 1 && r.top >= -1 };
    });
    expect(reachable.found, 'no primary action in the dialog').toBe(true);
    expect(reachable.inView, 'the primary action cannot be scrolled into view').toBe(true);
});
