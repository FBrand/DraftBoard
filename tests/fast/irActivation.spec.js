import { test } from '@playwright/test';
import { expect, openWarm, dragTo } from './helpers';

/**
 * Coming back off injured reserve.
 *
 * Putting somebody on IR is a drag into the zone; bringing him back is the same
 * gesture in reverse, and `performMove` has always meant it to work — it clears
 * the injury arrival on the way out, because "leaving injured reserve is being
 * activated". Nothing tested the return trip. The existing IR test drags to
 * CUTS, which empties the slot but releases the player rather than activating
 * him, so it passes whether or not a man can actually come back.
 *
 * Uses whoever the warm snapshot already has on IR, one drag and no setup —
 * the same preconditions as that test, so a failure here cannot be blamed on
 * the state this one built for itself.
 */
test('roster: a player on injured reserve can be brought back onto the 53', async ({ page }) => {
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    const irNames = () => page.$$eval('.roster-ir .rv-slot-name', els => els.map(e => e.textContent.trim()));

    const onIr = await irNames();
    expect(onIr.length).toBeGreaterThan(0);
    const injured = onIr[0];

    // An empty 53 slot that is not itself in IR or cuts.
    const targetIndex = await page.evaluate(() => [...document.querySelectorAll('.rv-slot')]
        .findIndex(el => !el.querySelector('.rv-slot-name')
            && !el.closest('.roster-ir') && !el.closest('.roster-cuts')));
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    const target = page.locator('.rv-slot').nth(targetIndex);
    const source = page.locator('.roster-ir .rv-slot').first();
    await target.scrollIntoViewIfNeeded();
    await source.scrollIntoViewIfNeeded();

    await dragTo(page, source, target);

    // He is off injured reserve...
    await expect.poll(irNames, { timeout: 15_000 }).not.toContain(injured);

    // ...and back on the roster, rather than gone.
    const onRoster = await page.evaluate((name) => [...document.querySelectorAll('.rv-slot-name')]
        .some(e => e.textContent.trim() === name && !e.closest('.roster-ir') && !e.closest('.roster-cuts')), injured);
    expect(onRoster).toBe(true);
});
