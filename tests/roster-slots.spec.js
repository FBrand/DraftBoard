import { test, expect } from '@playwright/test';
import { openApp, ensureRoster, slotNames, dragTo, seedRosterRow, trackErrors } from './helpers.js';

// Regressions from the "cutting a player leaves an unusable cell / moving a
// player onto the empty cell behind him makes him disappear" report. Both came
// from conflating an array index with a rendered position when a row has a
// null hole in it.
test.describe('depth chart slots with holes', () => {
    test('a player after a hole still renders in every zone', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        await seedRosterRow(page, (s53, PS) => {
            const arr = [];
            for (let i = 0; i < s53; i++) arr[i] = { name: `Fifty${i}`, zone: '53' };
            arr[s53 + 0] = { name: 'PsAlpha', zone: 'ps' };
            arr[s53 + 1] = null;                                  // hole
            arr[s53 + 2] = { name: 'PsBravo', zone: 'ps' };       // after a hole
            const rStart = s53 + PS;
            arr[rStart + 0] = null;                               // hole
            arr[rStart + 1] = { name: 'ResCharlie', zone: 'r' };  // after a hole
            return arr;
        });

        await page.reload();
        await ensureRoster(page);

        const names = await slotNames(page);
        expect(names).toContain('PsAlpha');
        expect(names).toContain('PsBravo');
        expect(names).toContain('ResCharlie');
    });

    test('cutting a mid-row player leaves a usable empty cell', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page);
        await ensureRoster(page);

        await seedRosterRow(page, (s53) => {
            const arr = [];
            for (let i = 0; i < s53; i++) arr[i] = { name: `Fifty${i}`, zone: '53' };
            arr[s53 + 0] = { name: 'PsOne', zone: 'ps' };
            arr[s53 + 1] = { name: 'PsTwo', zone: 'ps' };
            return arr;
        });
        await page.reload();
        await ensureRoster(page);

        await dragTo(page,
            page.locator('.rv-slot.filled').filter({ hasText: 'PsOne' }).first(),
            page.locator('.roster-cuts'));

        // PsOne moved to cuts, not deleted
        expect(await slotNames(page)).toContain('PsOne');

        // The vacated cell is a real drop target: moving PsTwo into it must
        // not make PsTwo vanish (the reported bug).
        const psColumn = page.locator('.rv-row-cell').nth(2);
        await dragTo(page,
            page.locator('.rv-slot.filled').filter({ hasText: 'PsTwo' }).first(),
            psColumn.locator('.rv-slot.empty-square').first());

        expect(await slotNames(page)).toContain('PsTwo');
        expect(errors).toEqual([]);
    });

    test('moving a reserve player onto the empty cell behind him keeps him', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        await seedRosterRow(page, (s53, PS) => {
            const arr = [];
            for (let i = 0; i < s53; i++) arr[i] = { name: `Fifty${i}`, zone: '53' };
            arr[s53 + PS] = { name: 'ResOne', zone: 'r' };
            return arr;
        });
        await page.reload();
        await ensureRoster(page);

        const reserveColumn = page.locator('.rv-row-cell.last').first();
        await dragTo(page,
            page.locator('.rv-slot.filled').filter({ hasText: 'ResOne' }).first(),
            reserveColumn.locator('.rv-slot.empty-square').first());

        expect(await slotNames(page)).toContain('ResOne');

        // and it survives a reload — i.e. state changed, not just the render
        await page.reload();
        await ensureRoster(page);
        expect(await slotNames(page)).toContain('ResOne');
    });

    test('deleting a position row moves its players to cuts rather than losing them', async ({ page }) => {
        await openApp(page);
        await ensureRoster(page);

        const firstRowPlayers = await page.locator('.rv-row-cell').nth(1).locator('.rv-slot-name').allTextContents();
        test.skip(firstRowPlayers.length === 0, 'first row has no players to lose');

        await page.locator('.rv-delete-pos').first().click();
        await page.waitForTimeout(500);

        const cuts = await page.locator('.roster-cuts .rv-slot-name').allTextContents();
        for (const name of firstRowPlayers) expect(cuts).toContain(name);
    });
});

test('an empty practice-squad row shows one drop target, not three', async ({ page }) => {
    // Regression: the fix for holes rendered all PS_SLOTS unconditionally,
    // leaving three "+" boxes on every empty row.
    await openApp(page);
    await ensureRoster(page);

    const counts = await page.evaluate(() => {
        // 4 cells per row: pos | 53-man | practice squad | reserve.
        const ps = document.querySelectorAll('.rv-row-cell')[2];
        return {
            empty: ps.querySelectorAll('.rv-slot.empty-square').length,
            filled: ps.querySelectorAll('.rv-slot.filled').length,
        };
    });
    expect(counts.filled).toBe(0);
    expect(counts.empty).toBe(1);
});
