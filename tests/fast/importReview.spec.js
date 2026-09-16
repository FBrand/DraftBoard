import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * An import is a proposal, not a bulk write.
 *
 * Parsing USED to be the write. `parseCSV` resolved every name with creation,
 * so a roster or candidate file minted a registry record for each stranger in
 * it before anybody saw what the file would do — and if the file was wrong, the
 * records stayed. `Add Players` has insisted on a verification step for a long
 * time; these two paths went around it.
 *
 * The check that matters is not that a dialog appears. It is that **nothing is
 * written while the question is open**: the dry-run parse resolves without
 * creating, so the registry must not move until Import is pressed.
 */
const registrySize = (page) => page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('db_players') || '{}')).length);

const csv = ['Phase,pos,slots53,slot1', 'O,QB,2,Totally New Person', 'O,RB,2,Second New Person'].join('\n');

test('free agency: importing candidates asks first, and writes nothing until it is told', async ({ page }) => {
    await openWarm(page, 'fa');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    const before = await registrySize(page);
    const slotsBefore = await page.locator('.rv-slot-name').count();

    await page.locator('.top-actions button').last().click();
    await page.locator('input[type="file"][accept=".csv"]').first()
        .setInputFiles({ name: 'fa.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

    const dialog = page.locator('.modal-content');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText(/never seen/i);

    // The whole point: the file has been read and nothing has been written.
    expect(await registrySize(page), 'the registry grew before anybody agreed').toBe(before);
    expect(await page.locator('.rv-slot-name').count()).toBe(slotsBefore);

    await dialog.locator('button').filter({ hasText: /Cancel/i }).first().click();
    await page.waitForTimeout(1_000);
    expect(await registrySize(page), 'cancelling still wrote').toBe(before);
    expect(await page.locator('.rv-slot-name').count()).toBe(slotsBefore);
});
