import { test, expect } from '@playwright/test';
import { openApp, gotoTab, ensureRoster, slotNames, dragTo, trackErrors } from './helpers.js';

// Undo used to exist only on the draft board, so a mis-drop in Roster, FA or
// Scouting was unrecoverable except by re-importing a CSV — the worst kind of
// mistake to make on air.
test.describe('undo', () => {
    test('roster: undoes a cut and restores the player', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);
        await ensureRoster(page);

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        // Nothing has changed yet, so there is nothing to undo.
        await expect(undo).toBeDisabled();

        const before = await slotNames(page);
        const cutsBefore = await page.locator('.roster-cuts .rv-slot-name').count();

        await dragTo(page,
            page.locator('.rv-slot.filled').first(),
            page.locator('.roster-cuts'));

        expect(await page.locator('.roster-cuts .rv-slot-name').count()).toBe(cutsBefore + 1);
        await expect(undo).toBeEnabled();

        await undo.click();
        await page.waitForTimeout(400);

        expect(await page.locator('.roster-cuts .rv-slot-name').count()).toBe(cutsBefore);
        expect(await slotNames(page)).toEqual(before);
        expect(errors).toEqual([]);
    });

    test('roster: undo survives a reload, i.e. it wrote through to storage', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        const before = await slotNames(page);
        await dragTo(page,
            page.locator('.rv-slot.filled').first(),
            page.locator('.roster-cuts'));
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.waitForTimeout(400);

        await page.reload();
        await ensureRoster(page);
        expect(await slotNames(page)).toEqual(before);
    });

    test('scouting: undo is per board', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        const topName = () => page.locator('.scouting-rank-row').first()
            .locator('.player-name').innerText();
        const undo = page.getByRole('button', { name: 'Undo', exact: true });

        await expect(undo).toBeDisabled();
        const consensusTop = await topName();

        // Promote someone on Consensus.
        await page.locator('.scouting-rank-row').nth(4).locator('.scouting-rank-card').click();
        await page.waitForTimeout(300);
        const rank = page.locator('.scouting-number-grid input').first();
        await rank.fill('1');
        await rank.blur();
        await page.waitForTimeout(700);
        expect(await topName()).not.toBe(consensusTop);
        await expect(undo).toBeEnabled();

        // Switching to a board with no history disables undo — one board's
        // history must not rewind another's.
        await page.locator('.board-switcher .switcher-btn', { hasText: 'Dan' }).click();
        await page.waitForTimeout(800);
        await expect(undo).toBeDisabled();

        // Back on Consensus the change is still undoable.
        await page.locator('.board-switcher .switcher-btn', { hasText: 'Consensus' }).click();
        await page.waitForTimeout(800);
        await expect(undo).toBeEnabled();
        await undo.click();
        await page.waitForTimeout(700);
        expect(await topName()).toBe(consensusTop);
    });

    test('free agency: undoes an added candidate', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);
        await gotoTab(page, 'fa');

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeDisabled();

        await page.getByRole('button', { name: '+ Add Candidate' }).click();
        await page.locator('.modal-content input').first().fill('Freddy Agent');
        await page.locator('.modal-content input').nth(1).fill('WR');
        await page.getByRole('button', { name: 'Add Candidate', exact: true }).click();
        await page.waitForTimeout(500);

        expect(await slotNames(page)).toContain('Freddy Agent');
        await expect(undo).toBeEnabled();

        await undo.click();
        await page.waitForTimeout(400);
        expect(await slotNames(page)).not.toContain('Freddy Agent');
    });
});
