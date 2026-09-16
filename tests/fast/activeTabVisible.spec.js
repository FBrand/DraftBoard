import { test } from '@playwright/test';
import { expect, TABS } from './helpers';
import { readFileSync } from 'node:fs';
import { SNAPSHOT_PATH } from './globalSetup';

/**
 * You can always see which stage you are on.
 *
 * The tab bar is wider than a phone screen and scrolls sideways, and it never
 * scrolled itself. Measured at 390px before the fix: `scrollLeft` stayed 0 with
 * 405px of scrollable width, so Draft Board was cut in half, and UDFA and
 * Roster were off screen entirely — the bar showed three stages you were NOT
 * on and nothing to say where you were.
 *
 * Each stage is reached by NAVIGATION, never by clicking its tab. The first
 * version of this test clicked through with `gotoTab` and passed against the
 * broken build, because a browser scrolls an element into view when you click
 * it — the test was creating the condition it was asserting. Arriving on a
 * stage cold, from a URL or from restored state, is the case that was broken
 * and the case a user is in when they reopen the app.
 */
const state = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

test('every stage shows its own tab when you arrive on it', async ({ page }) => {
    await page.addInitScript((data) => {
        if (localStorage.length > 0) return;
        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
    }, state);

    for (const id of Object.keys(TABS)) {
        await page.goto(`/?view=${id}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await page.waitForTimeout(600);

        const seen = await page.evaluate(() => {
            const active = document.querySelector('.view-tab.active');
            if (!active) return { found: false };
            const r = active.getBoundingClientRect();
            return {
                found: true,
                label: active.innerText.replace(/\s+/g, ' ').trim(),
                fully: r.left >= -1 && r.right <= window.innerWidth + 1,
            };
        });
        expect(seen.found, `no active tab after opening ${id}`).toBe(true);
        expect(seen.fully, `arriving at ${id}, its tab (${seen.label}) is not fully on screen`).toBe(true);
    }
});
