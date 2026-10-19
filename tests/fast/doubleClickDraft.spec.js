import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * A double-click takes one player, not two.
 *
 * The Remaining list drops a player the instant he is drafted, so the card
 * under the cursor is replaced by whoever was below him — and the second click
 * of an accidental double took THAT man. Measured before the fix: one
 * double-click on Fernando Mendoza drafted Mendoza at pick 1 AND Arvell Reese
 * at pick 2, with one Undo taking back only one of them. On air that is a pick
 * nobody made, announced before anybody notices.
 *
 * Three guards at the click were tried and measured and none can work: once the
 * list has re-flowed, nothing tells the second half of a double-click from a
 * deliberate one. So the list holds still for a moment instead.
 *
 * Both halves are pinned here, because the cure could easily be worse than the
 * bug: a double-click must take one, and two DELIBERATE picks in quick
 * succession must both still land.
 */
const drafted = (page) => page.evaluate(() =>
    [...document.querySelectorAll('.center-board-container .player-card')]
        // A card leads with its RANK ("#29 Ty Simpson"), drafted or not. What marks
        // a pick is "PK n" — filtering on the # counted the whole board.
        .map(c => c.innerText.replace(/\s+/g, ' ').trim()).filter(t => /\bPK\s*\d/.test(t)));

async function resetDraft(page) {
    await page.locator('button').filter({ hasText: /^More/ }).first().click();
    await page.locator('[role="menuitem"], .app-menu-item').filter({ hasText: /Reset Draft/i }).first().click();
    const confirm = page.locator('button').filter({ hasText: /Reset|Clear|Confirm|Yes/i }).last();
    if (await confirm.count()) await confirm.click();
    await expect.poll(async () => (await drafted(page)).length, { timeout: 30_000 }).toBe(0);
}

test('draft: a double-click takes one player, and two deliberate picks both land', async ({ page }) => {
    await openWarm(page, 'draft');
    // At 390px the player list is off-canvas behind a toggle, so waiting for
    // .left-panel to be VISIBLE never returns. phoneDraftHold.spec.js covers
    // this same guard on a phone, opening the list the way a finger does.
    test.skip(!(await page.locator('.left-panel').first().isVisible().catch(() => false)),
        'the player list is off-canvas at this width — see phoneDraftHold.spec.js');
    await page.waitForSelector('.left-panel', { timeout: 45_000 });
    await resetDraft(page);

    // One double-click, one player.
    await page.locator('.left-panel .player-card').first().click({ clickCount: 2, delay: 30 });
    await page.waitForTimeout(3000);
    expect(await drafted(page)).toHaveLength(1);

    // And the repeat click must not have opened his card over the board.
    await expect(page.locator('.modal-overlay, [role="dialog"]')).toHaveCount(0);

    // Two deliberate picks inside the hold window both land — the held card is
    // inert, the list is not.
    await resetDraft(page);
    await page.locator('.left-panel .player-card').first().click();
    await page.waitForTimeout(600);
    await page.locator('.left-panel .player-card').nth(1).click();

    await expect.poll(async () => (await drafted(page)).length, { timeout: 20_000 }).toBe(2);
});
