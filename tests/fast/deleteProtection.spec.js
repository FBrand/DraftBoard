import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * Deleting a player is for a mistake, not for losing somebody's work.
 *
 * playerWork.js exists because a delete once "took the player out from under
 * every board, remarks and placements included, with nothing to undo it". So a
 * player nobody has touched stays freely deletable, and one who has been
 * placed, tagged or written about is offered "clear MY opinions of him"
 * instead — which is what somebody actually wants when they reach for delete on
 * a player who turns out to be someone else's.
 *
 * Untested until now, and the failure is silent and unrecoverable: the button
 * appears, the player goes, and three analysts lose him at once.
 */
test('scouting: a player other boards have worked on cannot be removed outright', async ({ page }) => {
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 45_000 });

    const panel = page.locator('.side-panel.right-panel');
    await page.locator('.sg-row').first().click();
    // The admin block only appears once the card is unlocked.
    await panel.locator('button').filter({ hasText: '✎' }).first().click();
    await expect(panel.locator('.scouting-prospect-admin')).toBeVisible({ timeout: 15_000 });

    // He is ranked on every shipped board, so he is nobody's to delete.
    await expect(panel.locator('button').filter({ hasText: /^Remove player$/ })).toHaveCount(0);
    await expect(panel.locator('.scouting-prospect-admin')).toContainText(/clear those first/i);

    // What IS offered is clearing this board's own opinions of him.
    const clear = panel.locator('button').filter({ hasText: /^Clear evaluations$/ });
    await expect(clear).toHaveCount(1);

    const named = (await panel.locator('.scouting-prospect-admin').innerText()).toUpperCase();
    expect(named).toContain('CONSENSUS');

    await clear.first().click();
    await panel.locator('button').filter({ hasText: /^Clear$/ }).first().click();

    // Clearing one board does not make him deletable — the others still hold
    // work on him, and the card says which.
    await expect.poll(async () =>
        (await panel.locator('.scouting-prospect-admin').innerText()).toUpperCase(),
    { timeout: 15_000 }).not.toContain('CONSENSUS');

    await expect(panel.locator('button').filter({ hasText: /^Remove player$/ })).toHaveCount(0);
    await expect(panel.locator('.scouting-prospect-admin')).toContainText(/clear those first/i);
});
