import { test } from '@playwright/test';
import { expect, openWarm, gotoTab } from './helpers';

/**
 * A remark is a person's opinion, and the card says whose.
 *
 * The stack under a player used to be built by walking BOARDS and fetching
 * each one's remarks under that board's author. Two failures came out of that,
 * and neither was visible from the screen — which is why these are browser
 * tests and not unit ones.
 *
 * An analyst's own notes vanished from the stack the moment his voice was not
 * the board's: written, stored, acknowledged, and not shown. And the
 * "everybody else" stack was filtered by the ACTIVE BOARD rather than by whose
 * voice it was, so on somebody else's board your own notes appeared twice —
 * once in the editable list, once again below it.
 */
test('scouting: what you write appears once, and is still there after a reload', async ({ page }) => {
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 45_000 });

    const panel = page.locator('.side-panel.right-panel');
    await page.locator('.sg-row').first().click();

    const text = `written by me ${Date.now()}`;
    const field = panel.getByPlaceholder(/Add strength/i);
    await expect(field).toBeVisible({ timeout: 20_000 });
    await field.fill(text);
    await field.press('Enter');

    // Once. The duplicate came from the old active-board filter letting your
    // own voice through into the stack of everybody else's.
    await expect(panel.getByText(text, { exact: false })).toHaveCount(1);

    // Deliberately no click after the reload: the selection persists, the
    // panel comes back open on the same player, and clicking the row again
    // would TOGGLE it shut. The first version of this test did exactly that
    // and read the empty page as a lost remark.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sg-row', { timeout: 45_000 });
    await expect(panel.getByText(text, { exact: false })).toHaveCount(1, { timeout: 20_000 });
});

/**
 * The shipped example is attributed, and attributed to a person.
 *
 * It is filed under Dan (see utils/exampleEvaluations.js), so the card has to
 * find it by looking up who that voice IS. Nothing about the board being
 * viewed can tell it, which is the whole point: the player card here is opened
 * from the DRAFT board, which has no author at all.
 */
test('the card names who wrote what, on a board with no author of its own', async ({ page }) => {
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 45_000 });
    await gotoTab(page, 'draft');

    // Mansoor Delane is the first player in evaluations_kc_2026.csv.
    const card = page.locator('.scouting-modal-box');
    const player = page.locator('.player-card', { hasText: 'Delane' }).first();
    await expect(player).toBeVisible({ timeout: 30_000 });
    await player.click({ button: 'right' });
    await expect(card).toBeVisible({ timeout: 20_000 });

    // A heading carrying a PERSON'S NAME. Under the board-walked version this
    // was a board label, and anybody without a board could not appear at all.
    await expect(card.locator('.scouting-board-notes-header', { hasText: 'Dan' }).first())
        .toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('Sticky man-cover corner', { exact: false }).first())
        .toBeVisible({ timeout: 20_000 });
});
