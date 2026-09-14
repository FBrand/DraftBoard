import { test } from '@playwright/test';
import { openWarm, gotoTab, slotNames, dragTo } from './helpers';

const errs = (page) => {
    const f = [];
    page.on('console', m => { if (m.type() === 'error') f.push(m.text().slice(0, 120)); });
    page.on('pageerror', e => f.push('PAGEERROR ' + e.message.slice(0, 120)));
    return f;
};

const openSeasons = async (page) => {
    await page.locator('.view-tabbar-actions .app-menu-trigger').click();
    await page.getByRole('menuitem', { name: /Seasons/i }).click();
    await page.waitForSelector('.season-modal', { timeout: 10_000 });
};

test('an archived season really refuses writes, on every stage', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });


    await openSeasons(page);
    await page.locator('#season-year').fill('2040');
    await page.getByRole('button', { name: /Roll over/i }).click();
    await page.waitForLoadState('load');
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });

    await openSeasons(page);
    await page.locator('.season-open').filter({ hasText: '2026' }).click();
    await page.waitForLoadState('load');
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });

    console.log('HARD banner=', await page.locator('.season-banner').count());

    // Roster: a drag must not stick.
    await gotoTab(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    const names = await slotNames(page);
    await dragTo(page, page.locator('.rv-slot-name').first(), page.locator('.roster-cuts').first());
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    console.log('HARD archived-roster unchangedAfterReload=', JSON.stringify(await slotNames(page)) === JSON.stringify(names));

    // Scouting: the ranking must not reorder.
    await gotoTab(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 45_000 });
    await page.waitForSelector('.scouting-rank-row', { timeout: 45_000 });
    await page.waitForTimeout(800);
    const order = await page.locator('.scouting-rank-row').first().innerText();
    const rows = page.locator('.scouting-rank-row');
    await dragTo(page, rows.nth(0), rows.nth(4));
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('.sg-row', { timeout: 45_000 });
    await page.waitForSelector('.scouting-rank-row', { timeout: 45_000 });
    await page.waitForTimeout(600);
    console.log('HARD archived-scouting unchangedAfterReload=', (await page.locator('.scouting-rank-row').first().innerText()) === order);

    // And the current season is still writable.
    await openSeasons(page);
    await page.locator('.season-open').filter({ hasText: '2040' }).click();
    await page.waitForLoadState('load');
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
    console.log('HARD back-to-current banner=', await page.locator('.season-banner').count());
    console.log('HARD errors=', JSON.stringify(e.slice(0, 3)));
});

test('a failed write is undone and said out loud', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    const before = await slotNames(page);

    // Make the store refuse, the way a full quota or a rejected rule would.
    await page.evaluate(() => {
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
            if (String(k).startsWith('db_depth_rows')) throw new Error('quota simulated');
            return real.call(this, k, v);
        };
    });

    await dragTo(page, page.locator('.rv-slot-name').first(), page.locator('.rv-slot-name').nth(2));
    await page.waitForTimeout(900);

    const toast = await page.locator('.app-toast').innerText().catch(() => 'none');
    const after = await slotNames(page);
    console.log('HARD write-fail toast=', JSON.stringify(toast.replace(/\n/g, ' ').slice(0, 90)));
    console.log('HARD write-fail rolledBack=', JSON.stringify(after) === JSON.stringify(before));
    console.log('HARD write-fail errors=', JSON.stringify(e.slice(0, 2)));
});

test('board CSV round-trips through its own importer', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 30_000 });
    const before = await page.locator('.sg-row').count();

    const download = page.waitForEvent('download');
    await page.locator('.top-panel .app-menu-trigger').click();
    await page.getByRole('menuitem', { name: /Export Board CSV/i }).click();
    const file = await download;
    const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    const lines = text.trim().split('\n');
    console.log('HARD csv rows=', lines.length - 1, 'header=', lines[0].slice(0, 60));
    console.log('HARD csv coversBoard=', lines.length - 1 >= before);
    console.log('HARD csv errors=', JSON.stringify(e.slice(0, 2)));
});
