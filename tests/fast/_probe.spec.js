import { test } from '@playwright/test';
import { openWarm, gotoTab, slotNames } from './helpers';

test('picks trimmed, nothing lost', async ({ page }) => {
    await openWarm(page);
    for (const t of ['fa', 'scouting', 'draft', 'udfa', 'roster']) {
        await gotoTab(page, t);
        await page.waitForTimeout(1800);
    }

    const rosterBefore = await slotNames(page);
    const before = await page.evaluate(() => {
        let total = 0; const per = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i); const n = (localStorage.getItem(k) || '').length;
            total += n + k.length; per.push([k, n]);
        }
        per.sort((a, b) => b[1] - a[1]);
        const picks = Object.values(JSON.parse(localStorage.getItem('db_draft_picks') || '{}'));
        return {
            totalKB: Math.round(total / 1024),
            picksKB: Math.round((localStorage.getItem('db_draft_picks') || '').length / 1024),
            avg: Math.round(picks.reduce((s, p) => s + JSON.stringify(p).length, 0) / picks.length),
            sample: picks.find(p => Number.isFinite(Number(p.pickNumber))),
        };
    });
    console.log('AFTER TRIM', JSON.stringify(before));

    // Nothing the app shows may have changed.
    await gotoTab(page, 'draft');
    await page.waitForTimeout(1800);
    const board = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.center-board-container .player-card')];
        return {
            total: cards.length,
            withPick: cards.filter(c => /PK\s*\d/.test(c.textContent)).length,
            sample: cards.find(c => /PK\s*\d/.test(c.textContent))?.textContent.replace(/\s+/g, ' ').slice(0, 60),
        };
    });
    console.log('BOARD', JSON.stringify(board));

    await gotoTab(page, 'roster');
    await page.waitForTimeout(1800);
    console.log('ROSTER same=', JSON.stringify(await slotNames(page)) === JSON.stringify(rosterBefore));
    const tags = await page.evaluate(() => [...document.querySelectorAll('.rv-slot-tag')].map(t => t.textContent).filter(Boolean).slice(0, 6));
    console.log('ROSTER TAGS', JSON.stringify(tags));
});
