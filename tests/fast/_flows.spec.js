import { test } from '@playwright/test';
import { openWarm, slotNames, dragTo } from './helpers';

// Driving the app, not inspecting it. Each of these is a thing a person does
// end to end; the assertion is that the result is what they asked for and that
// it is still there after a reload.
const errs = (page) => {
    const found = [];
    page.on('console', m => { if (m.type() === 'error') found.push(m.text().slice(0, 120)); });
    page.on('pageerror', e => found.push('PAGEERROR ' + e.message.slice(0, 120)));
    return found;
};

test('scouting: place a player, and the numbers follow him', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 30_000 });

    const first = await page.locator('.scouting-rank-row').first().innerText();
    const rows = page.locator('.scouting-rank-row');
    await dragTo(page, rows.nth(0), rows.nth(4));
    await page.waitForTimeout(600);
    const moved = await page.locator('.scouting-rank-row').first().innerText();
    console.log('FLOW scouting-drag movedFirstRow=', moved !== first);

    await page.reload();
    await page.waitForSelector('.scouting-rank-row', { timeout: 45_000 });
    console.log('FLOW scouting-drag survived=', (await page.locator('.scouting-rank-row').first().innerText()) === moved);
    console.log('FLOW scouting-drag errors=', JSON.stringify(e.slice(0, 3)));
});

test('draft: a click drafts while it runs, and reads once it is over', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'draft');
    await page.waitForSelector('.center-board-container .player-card', { timeout: 45_000 });

    // The seeded offseason is a COMPLETED draft, so a click here opens the
    // player rather than drafting him — there is nothing left to draft. It
    // used to open a UDFA signing form, which belongs to the UDFA stage.
    await page.locator('.center-board-container .player-card.available').first().click();
    await page.waitForTimeout(700);
    console.log('FLOW draft-over opensCard=', await page.locator('.scouting-modal-box').count());
    await page.keyboard.press('Escape');

    // Wind it back mid-draft and the same click must take him.
    await page.evaluate(() => {
        const k = 'db_draft_state';
        const docs = JSON.parse(localStorage.getItem(k) || '{}');
        const id = Object.keys(docs)[0];
        docs[id] = { ...docs[id], value: { ...docs[id].value, currentPick: 12 } };
        localStorage.setItem(k, JSON.stringify(docs));
    });
    await page.reload();
    await page.waitForSelector('.center-board-container .player-card', { timeout: 45_000 });
    const card = page.locator('.center-board-container .player-card.available').first();
    const before = await card.innerText();
    await card.click();
    await page.waitForTimeout(700);
    const took = await page.evaluate((t) => !document.querySelector('.center-board-container .player-card') ||
        ![...document.querySelectorAll('.center-board-container .player-card')].some(x => x.innerText === t), before);
    console.log('FLOW draft-running tookHim=', took);
    console.log('FLOW draft errors=', JSON.stringify(e.slice(0, 3)));
});

test('roster: cut a player and sign him back', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    const before = await slotNames(page);
    const victim = before[0];
    await dragTo(page, page.locator('.rv-slot-name').first(), page.locator('.roster-cuts').first());
    await page.waitForTimeout(700);

    const cut = await page.evaluate((n) => ({
        inCuts: [...document.querySelectorAll('.roster-cuts .rv-slot')].some(s => s.textContent.includes(n)),
        onChart: [...document.querySelectorAll('.roster-grid .rv-slot')].some(s => s.textContent.includes(n)),
    }), victim);
    console.log('FLOW roster-cut', victim, JSON.stringify(cut));

    await page.reload();
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    const survived = await page.evaluate((n) => [...document.querySelectorAll('.roster-cuts .rv-slot')].some(s => s.textContent.includes(n)), victim);
    console.log('FLOW roster-cut survived=', survived);
    console.log('FLOW roster errors=', JSON.stringify(e.slice(0, 3)));
});

test('fa: add a candidate and see him', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'fa');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    const before = await page.locator('.rv-slot-name').count();

    await page.getByRole('button', { name: /Add Candidate|\+ Add/i }).first().click();
    const modal = page.locator('.modal-content');
    await modal.waitFor({ timeout: 10_000 });
    await modal.locator('input').nth(0).fill('Audit Candidate');
    await page.locator('.up-position-pair select').selectOption({ index: 1 });
    await page.getByRole('button', { name: /Add as FA Target/i }).click();
    await page.waitForTimeout(900);

    const after = await page.locator('.rv-slot-name').count();
    const visible = await page.evaluate(() => [...document.querySelectorAll('.rv-slot-name')].some(n => n.textContent.includes('Audit Candidate')));
    console.log('FLOW fa-add before=', before, 'after=', after, 'visible=', visible);
    console.log('FLOW fa errors=', JSON.stringify(e.slice(0, 3)));
});

test('udfa: sign somebody and find him', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'udfa');
    await page.waitForSelector('.center-board-container .player-card', { timeout: 45_000 });
    const before = await page.locator('.center-board-container .player-card').count();

    const card = page.locator('.center-board-container .player-card').first();
    const name = (await card.innerText()).split('\n').filter(Boolean).pop();
    await card.click();
    await page.waitForTimeout(700);
    const modal = page.locator('.modal-content');
    if (await modal.count()) {
        await page.getByRole('button', { name: /^Sign UDFA$/i }).click();
        await page.waitForTimeout(900);
    }
    const after = await page.locator('.center-board-container .player-card').count();
    const inPanel = await page.evaluate(() => document.querySelectorAll('.udfa-signed-panel .player-card').length);
    console.log('FLOW udfa', name, 'boardBefore=', before, 'boardAfter=', after, 'signedPanel=', inPanel);
    console.log('FLOW udfa errors=', JSON.stringify(e.slice(0, 3)));
});

test('overlays: escape and the backdrop both close, and focus is not trapped', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'scouting');
    await page.waitForSelector('.sg-row', { timeout: 30_000 });

    const opens = [
        ['help', async () => page.getByRole('button', { name: /Help/i }).first().click(), '.help-modal, .modal-content'],
        ['seasons', async () => {
            await page.locator('.view-tabbar-actions .app-menu-trigger').click();
            await page.getByRole('menuitem', { name: /Seasons/i }).click();
        }, '.season-modal'],
        ['add players', async () => page.getByRole('button', { name: '+ Add Players' }).click(), '.add-prospects'],
    ];

    for (const [label, open, sel] of opens) {
        await open();
        await page.waitForSelector(sel, { timeout: 10_000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        const closedByEsc = (await page.locator(sel).count()) === 0;

        await open();
        await page.waitForSelector(sel, { timeout: 10_000 });
        await page.mouse.click(5, 400); // the backdrop, away from the box
        await page.waitForTimeout(400);
        const closedByBackdrop = (await page.locator(sel).count()) === 0;

        console.log(`FLOW overlay ${label} esc=${closedByEsc} backdrop=${closedByBackdrop}`);
        if (!closedByBackdrop) await page.keyboard.press('Escape');
    }
    console.log('FLOW overlays errors=', JSON.stringify(e.slice(0, 3)));
});

test('session: export and import round-trips every stage', async ({ page }) => {
    const e = errs(page);
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    const before = await slotNames(page);

    const download = page.waitForEvent('download');
    await page.locator('.view-tabbar-actions .app-menu-trigger').click();
    await page.getByRole('menuitem', { name: /Export Full Session/i }).click();
    const file = await download;
    const path = await file.path();
    const text = await (await import('node:fs/promises')).readFile(path, 'utf8');
    const parsed = JSON.parse(text);
    console.log('FLOW session keys=', Object.keys(parsed.data ?? {}).length, 'format=', parsed.format);

    // Wipe, then restore from the file.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });

    await page.locator('.view-tabbar-actions .app-menu-trigger').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Full Session/i }).click();
    (await chooser).setFiles(path);
    await page.waitForTimeout(2500);
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });

    const after = await slotNames(page);
    console.log('FLOW session restored=', JSON.stringify(after) === JSON.stringify(before), after.length, 'of', before.length);
    console.log('FLOW session errors=', JSON.stringify(e.slice(0, 3)));
});
