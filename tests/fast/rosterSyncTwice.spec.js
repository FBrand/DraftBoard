import { test } from '@playwright/test';
import { expect, openWarm, dragTo } from './helpers';

/**
 * "Sync from FA/Draft/UDFA", run twice with a hand edit in between.
 *
 * The plan asked for exactly this and it had only ever been covered by unit
 * tests on the merge function. What makes the action safe to offer at any
 * point in the offseason — rather than a one-time bootstrap that goes stale —
 * is that it only ever FILLS: it never overwrites an occupied slot and never
 * removes anybody. A hand edit made between two syncs is the sharpest way to
 * ask, because a merge that rebuilt from source would quietly undo it.
 *
 * Counting note: a CUT player is still a `.rv-slot` and still carries a
 * `.rv-slot-name`, because a cut is a slot now rather than a bare name.
 * Counting every `.rv-slot-name` on the page therefore reports the SAME total
 * before and after a cut, and "the edit did not take" is then a fact about the
 * selector, not the app. The 53-man count has to exclude the cut panel.
 */
const rosterState = (page) => page.evaluate(() => {
    const cutEls = new Set(document.querySelectorAll('.roster-cuts-list .rv-slot-name'));
    const text = (el) => el.textContent.trim();
    return {
        onRoster: [...document.querySelectorAll('.rv-slot-name')].filter(el => !cutEls.has(el)).map(text),
        cuts: [...cutEls].map(text),
    };
});

const sync = async (page) => {
    const btn = page.locator('button').filter({ hasText: /Sync from/i }).first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(3_000);
    return rosterState(page);
};

test('roster: syncing again fills empty slots without undoing a hand edit', async ({ page }) => {
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    const first = await sync(page);
    expect(first.onRoster.length).toBeGreaterThan(0);

    // Cut somebody by hand — the edit the second sync must not undo.
    const source = page.locator('.roster-grid .rv-slot').filter({ has: page.locator('.rv-slot-name') }).first();
    await source.scrollIntoViewIfNeeded();
    const cutName = (await source.locator('.rv-slot-name').innerText()).trim();
    const cutZone = page.locator('.roster-cuts').first();
    await cutZone.scrollIntoViewIfNeeded();
    await dragTo(page, source, cutZone);
    await page.waitForTimeout(2_000);

    const afterCut = await rosterState(page);
    expect(afterCut.onRoster).not.toContain(cutName);
    expect(afterCut.cuts).toContain(cutName);

    const second = await sync(page);

    // The point of the test: a re-sync leaves the hand edit alone.
    expect(second.onRoster).not.toContain(cutName);

    // And it displaces nobody who was already placed.
    const lost = afterCut.onRoster.filter(n => !second.onRoster.includes(n));
    expect(lost).toEqual([]);
});
