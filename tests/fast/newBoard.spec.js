import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * A board created in the app is its own board.
 *
 * This is how a fourth analyst joins, and it opened showing somebody else's
 * work: 313 ranked players carrying the consensus board's placements, on a
 * board whose own dialog promises "every player starts unranked". Storage was
 * empty the whole time — only the screen lied, which is the worst combination,
 * because an analyst starts ranking against another man's board believing it
 * is blank.
 *
 * Two causes, so two things to pin: a board with no rankings file must carry
 * every player UNRANKED rather than falling through to the default pool, and
 * it must do so immediately — the board list is read once and cached, so a
 * board created afterwards was invisible to the pools until a reload.
 */
const rows = (page) => page.evaluate(() => ({
    total: document.querySelectorAll('.sg-row').length,
    unranked: [...document.querySelectorAll('.sg-row')].filter(r => r.innerText.includes('???')).length,
}));

const entriesPerBoard = (page) => page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        const m = k && k.match(/^db_boards\/(b_[a-z0-9]+)\/entries$/);
        if (m) out[m[1]] = Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}')).length;
    }
    return out;
});

test('scouting: a new empty board carries every player, unranked, without a reload', async ({ page }) => {
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 45_000 });

    const before = await rows(page);
    const boardsBefore = await entriesPerBoard(page);
    const registryBefore = await page.evaluate(() =>
        Object.keys(JSON.parse(localStorage.getItem('db_players') ?? '{}')).length);
    expect(before.total).toBeGreaterThan(100);

    await page.locator('button').filter({ hasText: /^More/ }).first().click();
    await page.locator('[role="menuitem"], .app-menu-item').filter({ hasText: /New Board/i }).first().click();
    await page.locator('.modal-overlay input.text-input, [role="dialog"] input').first().fill('Fourth Analyst');
    await page.locator('button').filter({ hasText: /^Create Board$/ }).first().click();

    // Immediately — no reload. This is the half that needed the board list
    // forgotten as well as the pools.
    await expect.poll(async () => (await rows(page)).unranked, { timeout: 30_000 })
        .toBeGreaterThan(100);

    const after = await rows(page);
    expect(after.unranked).toBe(after.total);      // every player, none placed
    expect(after.total).toBeGreaterThanOrEqual(before.total);

    // The boards that already existed are untouched, and no player was minted
    // twice — a new board reuses the registry, which is what it is for.
    const boardsAfter = await entriesPerBoard(page);
    for (const [id, count] of Object.entries(boardsBefore)) {
        expect(boardsAfter[id]).toBe(count);
    }
    expect(await page.evaluate(() =>
        Object.keys(JSON.parse(localStorage.getItem('db_players') ?? '{}')).length)).toBe(registryBefore);

    // And it is still itself after a reload.
    await page.reload();
    await page.waitForSelector('.sg-row', { timeout: 45_000 });
    await expect.poll(async () => (await rows(page)).unranked, { timeout: 30_000 })
        .toBeGreaterThan(100);
    const reloaded = await rows(page);
    expect(reloaded.unranked).toBe(reloaded.total);
});
