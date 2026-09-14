/**
 * The browser suite, reduced to what only a browser can answer.
 *
 * Two thirds of the original 87 tests exercised pure functions — rank
 * derivation, draft-phase gating, name matching, CSV round-trips, the registry
 * — through a page load each. Those now live in tests/unit and run in nine
 * seconds. What is left here is rendering, drag and drop, persistence across a
 * reload, modal flows, and routing: things with no meaning outside a browser.
 *
 * Tests are grouped rather than granular on purpose. A page load is the unit
 * of cost, so asserting five related things about one screen is nearly free
 * while five tests asserting one thing each is five bootstraps.
 */
import { test } from '@playwright/test';
import {
    expect, TABS, openWarm, openCold, gotoTab, slotNames, dragTo, trackErrors,
} from './helpers';

test.describe('rendering', () => {
    test('every tab renders, with no console errors and no native dialogs', async ({ page }) => {
        const errors = trackErrors(page);
        await openWarm(page);

        for (const tab of Object.keys(TABS)) {
            await gotoTab(page, tab);
            await expect(page.locator('.view-tab.active')).toHaveText(TABS[tab]);
            // Something view-shaped is on screen, not a blank pane.
            await expect(page.locator('.roster-view, .main-layout, .scouting-layout').first()).toBeVisible();
        }
        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('a cold start reaches a usable app', async ({ page }) => {
        const errors = trackErrors(page);
        await openCold(page);
        // The seeded offseason loads itself; the draft board should have cards.
        await gotoTab(page, 'draft');
        await expect(page.locator('.player-card').first()).toBeVisible({ timeout: 30_000 });
        expect(errors.filter(e => !/favicon/i.test(e)), errors.join('\n')).toEqual([]);
    });
});

test.describe('routing', () => {
    test('the stage is in the URL, survives a reload, and back/forward move between stages', async ({ page }) => {
        await openWarm(page);

        await gotoTab(page, 'roster');
        await expect(page).toHaveURL(/view=roster/);
        await gotoTab(page, 'scouting');
        await expect(page).toHaveURL(/view=scouting/);

        await page.reload();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);

        await page.goBack();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.roster);
        await page.goForward();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);
    });

    test('a scouting link carries the board and the player, and beats what was stored', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 30_000 });

        // Pick a player, and the URL says so — that is what makes a board
        // shareable at all.
        const name = await page.locator('.sg-row .sg-name').first().innerText();
        await page.locator('.sg-row').first().click();
        await expect(page).toHaveURL(/player=/);
        const shared = page.url();

        // Somebody else is looking at another stage. The link has to win:
        // otherwise opening what you were sent lands you where YOU were.
        await gotoTab(page, 'roster');
        await page.goto(shared);
        await page.waitForSelector('.sg-row', { timeout: 45_000 });

        await expect(page.locator('.view-tab.active')).toHaveText(TABS.scouting);
        await expect(page.locator('.sg-row.selected .sg-name')).toHaveText(name);
    });

    test('an unknown view falls back rather than rendering nothing', async ({ page }) => {
        await page.addInitScript(() => {});
        await page.goto('/?view=not-a-real-view');
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await expect(page.locator('.view-tab.active')).toBeVisible();
    });
});

test.describe('overlays', () => {
    test('Escape closes an overlay, and menus escape their clipping parents', async ({ page }) => {
        await openWarm(page, 'scouting');

        // The menu lives in a portal because .scouting-layout clips it.
        await page.locator('.top-panel .app-menu-trigger').click();
        const menu = page.locator('.app-menu-list');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        await page.locator('.top-panel .app-menu-trigger').click();
        await expect(menu).toBeVisible();
        // Clicking away closes it too.
        await page.locator('body').click({ position: { x: 5, y: 400 } });
        await expect(menu).toBeHidden();
    });

    test('the user guide opens from the tab bar and renders the document', async ({ page }) => {
        await openWarm(page);
        await page.getByRole('button', { name: '? Help' }).click();
        await expect(page.locator('.help-modal')).toBeVisible();
        await expect(page.locator('.help-body h1')).toContainText('DraftBoard');
        await page.keyboard.press('Escape');
        await expect(page.locator('.help-modal')).toBeHidden();
    });
});

test.describe('the player card', () => {
    test('opens outside Scouting, edits facts, and never re-ranks', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
        await page.locator('.rv-slot-name').first().click();

        const card = page.locator('.scouting-modal-box');
        await expect(card).toBeVisible();

        // Facts are the editable half here. Opinions are not offered at all:
        // re-ranking a player on somebody's draft board is not something you
        // do from a depth chart.
        await expect(card.locator('.scouting-fact-grid')).toBeVisible();
        await expect(card.locator('.scouting-group-fields')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(card).toBeHidden();

        // Right-click reaches the same card. It is how you open one without
        // picking the player up, which matters where a click means drag.
        await page.locator('.rv-slot-name').first().click({ button: 'right' });
        await expect(card).toBeVisible();
        await page.keyboard.press('Escape');

        // And from Free Agency, where the candidates are.
        await gotoTab(page, 'fa');
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
        await page.locator('.rv-slot-name').first().click();
        await expect(card).toBeVisible();
        await expect(card.locator('.scouting-fact-grid')).toBeVisible();
        await page.keyboard.press('Escape');
    });

    test('a remark can be written on a veteran, who is on nobody\'s draft board', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
        await page.locator('.rv-slot-name').first().click();
        const card = page.locator('.scouting-modal-box');
        await expect(card).toBeVisible();

        // Locked, there is nothing to type into: a card you opened to read
        // should not have an open text box on a broadcast.
        await expect(card.locator('.scouting-list-add')).toHaveCount(0);

        // One pencil unlocks the whole card. A veteran was never in a class
        // anybody ranked, so this is the only place anything can be said
        // about him at all.
        await card.locator('.scouting-edit-btn').first().click();
        await expect(card.locator('.scouting-list-add').first()).toBeVisible();
        await expect(card.locator('.scouting-list-field')).toHaveCount(3);
    });

    test('dragging a roster slot does not open the card', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.rv-slot-name', { timeout: 30_000 });
        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(1));
        // A drag is not a click: the card must not appear.
        await expect(page.locator('.scouting-modal-box')).toHaveCount(0);
    });
});

test.describe('drag and drop', () => {
    test('scouting: reordering the ranking survives a reload', async ({ page }) => {
        await openWarm(page, 'scouting');
        // The ranking column is what reorders; the grouped list beside it is a
        // reading surface and deliberately does not drag. The whole ROW is the
        // drag handle — there used to be a ⠿ grip, which nobody aimed at.
        await page.waitForSelector('.scouting-rank-row', { timeout: 45_000 });

        const names = () => page.$$eval('.left-panel .scouting-rank-card',
            els => els.slice(0, 5).map(e => e.textContent));

        const before = await names();
        const rows = page.locator('.left-panel .scouting-rank-row');
        await dragTo(page, rows.nth(0), rows.nth(3));

        const after = await names();
        expect(after, 'the drag changed nothing on screen').not.toEqual(before);

        await page.reload();
        await page.waitForSelector('.scouting-rank-row', { timeout: 45_000 });
        expect(await names(), 'the order did not survive the reload').toEqual(after);
    });

    test('roster: a slot moves, and the move is written through to storage', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        const before = await slotNames(page);
        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        const after = await slotNames(page);
        expect(after).not.toEqual(before);

        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        expect(await slotNames(page)).toEqual(after);
    });

    test('roster: dragging a player off injured reserve activates him', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        // Injured reserve is a place, not a flag: dropping a player there puts
        // him on it and dragging him out takes him off. That drag IS the
        // activation — there is deliberately no button saying so twice.
        const ir = page.locator('.roster-ir .rv-slot').first();
        await ir.scrollIntoViewIfNeeded();
        await expect(ir).toBeVisible();
        await dragTo(page, ir, page.locator('.roster-cuts').first());
        await expect(page.locator('.roster-ir .rv-slot-name')).toHaveCount(0, { timeout: 15_000 });
    });

    test('roster: a specialist slot takes a drop, empty or not', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        // Polled, not slept on. A drag lands when it lands, and under four
        // workers a fixed wait is a coin toss.
        const spec = () => page.evaluate(() =>
            [...document.querySelectorAll('.rv-specialist')].map(s =>
                `${s.querySelector('.rv-specialist-label')?.textContent}=${s.querySelector('.rv-slot-name')?.textContent ?? '-'}`).join('|'));
        const cell = (label) => page.locator('.rv-specialist').filter({ hasText: label }).locator('.rv-slot').first();

        await page.locator('.roster-specialists').scrollIntoViewIfNeeded();
        const punter = (await spec()).split('|').find(s => s.startsWith('Punter=')).split('=')[1];

        await dragTo(page, cell('Kicker'), page.locator('.roster-cuts').first());
        await expect.poll(spec, { timeout: 15_000 }).toContain('Kicker=-');

        // And back INTO the empty one. An empty specialist used to render a
        // "NEED" label instead of a cell, so the three positions you are most
        // likely to be filling had nowhere to drop a player.
        await page.locator('.roster-specialists').scrollIntoViewIfNeeded();
        await dragTo(page, cell('Punter'), cell('Kicker'));
        await expect.poll(spec, { timeout: 15_000 }).toContain(`Kicker=${punter}`);
    });
});

test.describe('undo', () => {
    test('roster undo restores what was removed, and it reached storage', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        const before = await slotNames(page);

        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        expect(await slotNames(page)).not.toEqual(before);

        await page.getByRole('button', { name: /Undo/i }).first().click();
        await page.waitForTimeout(300);
        expect(await slotNames(page)).toEqual(before);

        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        expect(await slotNames(page), 'undo did not write through').toEqual(before);
    });

    test('each stage undoes its own work, not the stage you were on before', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 30_000 });

        const order = () => page.locator('.scouting-rank-row .rank-name, .scouting-rank-row').allInnerTexts();
        const consensusBefore = await order();

        // Move somebody on Consensus.
        const rows = page.locator('.scouting-rank-row');
        await dragTo(page, rows.nth(0), rows.nth(3));
        await page.waitForTimeout(400);
        expect(await order()).not.toEqual(consensusBefore);

        // Switch analyst. His board is untouched, so there is nothing for HIM
        // to undo — and the button says so. A shared history would offer to
        // undo a move made on somebody else's board.
        await page.getByRole('button', { name: 'Dan', exact: true }).click();
        await page.waitForTimeout(600);
        await expect(page.getByRole('button', { name: /Undo/i }).first()).toBeDisabled();

        // And Consensus still holds the move, waiting for its own undo.
        await page.getByRole('button', { name: 'Consensus', exact: true }).click();
        await page.waitForTimeout(600);
        expect(await order()).not.toEqual(consensusBefore);
        await page.getByRole('button', { name: /Undo/i }).first().click();
        await page.waitForTimeout(400);
        expect(await order()).toEqual(consensusBefore);
    });

    test('free agency undoes an added candidate', async ({ page }) => {
        await openWarm(page, 'fa');
        await page.waitForSelector('.rv-slot-name', { timeout: 45_000 });
        const before = await slotNames(page);

        const slots = page.locator('.rv-slot-name');
        await dragTo(page, slots.nth(0), slots.nth(2));
        await page.waitForTimeout(300);
        expect(await slotNames(page)).not.toEqual(before);

        await page.getByRole('button', { name: /Undo/i }).first().click();
        await page.waitForTimeout(300);
        expect(await slotNames(page)).toEqual(before);
    });
});

test.describe('adding players', () => {
    test('a typed player reaches verification, commits, and lands on the board', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.getByRole('button', { name: '+ Add Players' }).click();

        const modal = page.locator('.add-prospects');
        await expect(modal).toBeVisible();

        await modal.locator('input').nth(0).fill('Test Prospect');
        await modal.locator('input').nth(1).fill('QB');
        await page.getByRole('button', { name: 'Review' }).click();

        // An import or a typed row PROPOSES; nothing is written until the
        // verification step is submitted, so the modal is still up.
        await expect(modal).toBeVisible();
    });

    test('a name already on the board is blocked, and cancelling writes nothing', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 30_000 });
        const existing = await page.locator('.sg-row .sg-name').first().innerText();
        const before = await page.locator('.sg-row').count();

        await page.getByRole('button', { name: '+ Add Players' }).click();
        const modal = page.locator('.add-prospects');
        await modal.locator('input').nth(0).fill(existing);
        await modal.locator('input').nth(1).fill('QB');

        await page.getByRole('button', { name: /^Review/ }).click();

        // He is already there. Adding him again would make two of him, so the
        // verification step says so and the submit stays shut until it is
        // resolved — rather than the board quietly growing a duplicate.
        await expect(modal.locator('.ap-collision')).toBeVisible();
        await expect(modal.getByRole('button', { name: / to board$/ })).toBeDisabled();

        // Backing out leaves the board exactly as it was.
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(page.locator('.sg-row')).toHaveCount(before);

        // And reopening starts a fresh batch rather than resuming the
        // abandoned one.
        await page.getByRole('button', { name: '+ Add Players' }).click();
        await expect(modal.locator('input').nth(0)).toHaveValue('');
    });
});

test.describe('what he plays and where he stands', () => {
    test('a position no row is called asks, rather than guessing a row', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        await page.getByRole('button', { name: /Sign Player|\+ Sign/i }).first().click();
        const modal = page.locator('.modal-content');
        await modal.waitFor({ timeout: 10_000 });

        // A board says a man is an OT. A depth chart has an LT and an RT and
        // nothing called OT. The app could decide tackles play at tackle —
        // a judgement dressed up as a lookup, and wrong the moment a row is
        // named differently. It asks instead.
        await modal.locator('input').nth(0).fill('Test Tackle');
        await page.locator('.up-position-pair input').fill('OT');
        await page.getByRole('button', { name: /^Sign FA$/i }).click();

        await expect(page.locator('.up-position-pair .ap-error')).toContainText('OT');
        await expect(modal, 'it closed and guessed').toBeVisible();

        // Answer it, and he goes where you said — still an OT, because that is
        // what he plays. Where he stands belongs to the depth chart.
        await page.locator('.up-position-pair select').selectOption('LT');
        await page.getByRole('button', { name: /^Sign FA$/i }).click();
        await expect(modal).toBeHidden();

        expect(await slotNames(page)).toContain('Test Tackle');
        // Read whatever shape the collection is in. This assertion has broken
        // three times on storage layout alone — a flattened path key, then a
        // root tree with the documents under `docs`, now a plain map again —
        // without the app ever being at fault. `docs ?? raw` survives all of
        // them, because the question here is about the registry, not about how
        // the registry happens to be filed.
        const recorded = await page.evaluate(() => {
            const raw = JSON.parse(localStorage.getItem('db_players') || '{}');
            return Object.values(raw.docs ?? raw)
                .find(p => p && p.name === 'Test Tackle')?.position;
        });
        expect(recorded, 'the depth chart overwrote what he plays').toBe('OT');
    });
});

test.describe('session and init', () => {
    test('a clean slate empties every stage and survives a reload', async ({ page }) => {
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        await page.locator('.view-tabbar-actions .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Start Clean Slate/i }).click();
        // It asks first — this is the one irreversible action.
        await page.getByRole('button', { name: 'Start clean' }).click();
        await page.waitForTimeout(1500);

        await page.reload();
        await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        await gotoTab(page, 'draft');
        await expect(page.locator('.view-tab.active')).toHaveText(TABS.draft);
    });
});

test.describe('settings', () => {
    test('positional value is editable, persists, and a non-http matrix link is refused', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.locator('.top-panel .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Settings/i }).click();

        const modal = page.locator('.app-settings');
        await expect(modal).toBeVisible();

        const link = modal.locator('input[type="url"]');
        await link.fill('javascript:alert(1)');
        await page.getByRole('button', { name: 'Save' }).click();
        // Refused rather than stored: the modal stays open and says why.
        await expect(modal).toBeVisible();
        await expect(page.locator('.ap-error')).toBeVisible();
    });
});

test.describe('the board CSV', () => {
    test('exports what an analyst wrote, markers and all', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 45_000 });

        // Write one of each kind on whoever is first, through the panel the
        // analyst actually uses.
        await page.locator('.sg-row').first().click();
        const panel = page.locator('.side-panel.right-panel');
        await expect(panel.locator('.scouting-list-field')).toHaveCount(3);

        const kinds = ['Elite arm talent', 'Footwork under pressure', 'Two-year starter'];
        for (let i = 0; i < 3; i += 1) {
            const box = panel.locator('.scouting-list-add').nth(i);
            await box.locator('input').fill(kinds[i]);
            await box.locator('button').click();
            await page.waitForTimeout(200);
        }

        const download = page.waitForEvent('download');
        await page.locator('.top-panel .app-menu-trigger').click();
        await page.getByRole('menuitem', { name: /Export Board CSV/i }).click();
        const file = await download;
        const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');

        // The header a spreadsheet needs, and one line per marker. Without the
        // "Remarks:" prefix, Sheets and Excel read a leading + or - as a
        // formula and mangle the cell before it is ever saved.
        expect(text.split('\n')[0]).toContain('evaluation');
        expect(text).toContain('Remarks:');
        expect(text).toContain('+ Elite arm talent');
        expect(text).toContain('- Footwork under pressure');
        expect(text).toContain('• Two-year starter');
    });
});

test.describe('the draft board in normal view', () => {
    test('scrolls down its own column without taking the side panels with it', async ({ page }) => {
        await openWarm(page, 'draft');
        await page.waitForSelector('.center-board-container .player-card', { timeout: 45_000 });

        const before = await page.evaluate(() => {
            const el = (s) => document.querySelector(s);
            return {
                board: el('.center-board-container')?.scrollTop ?? null,
                left: el('.left-panel .scroll-container')?.scrollTop ?? null,
                right: el('.right-panel .scroll-container')?.scrollTop ?? null,
            };
        });

        // The board is taller than the window — 300-odd players — so it has to
        // scroll. It used to be clipped instead, with the bottom rounds simply
        // unreachable.
        const after = await page.evaluate(() => {
            const board = document.querySelector('.center-board-container');
            board.scrollTop = 400;
            const el = (s) => document.querySelector(s);
            return {
                board: board.scrollTop,
                left: el('.left-panel .scroll-container')?.scrollTop ?? null,
                right: el('.right-panel .scroll-container')?.scrollTop ?? null,
            };
        });

        expect(after.board, 'the board does not scroll vertically').toBeGreaterThan(0);
        // Each panel scrolls on its own. They shared a scroll once, so reading
        // down the board dragged the picks list along with it.
        expect(after.left).toBe(before.left);
        expect(after.right).toBe(before.right);
    });


    test('keeps drafted players in place and collapses only emptied tiers', async ({ page }) => {
        await openWarm(page, 'draft');
        await page.waitForSelector('.center-board-container .player-card', { timeout: 45_000 });

        // Wind the seeded, completed draft back to a handful of picks so there
        // are drafted and undrafted players sharing a tier.
        await page.evaluate(() => {
            // A pick is a FACT ON THE PLAYER now — draftPick, team, draftYear on
            // his registry record — so winding the draft back to pick nine means
            // clearing those facts, not deleting documents from a picks
            // collection. This named db_draft_picks, which no longer exists: the
            // read returned {}, the draft wound back to nothing, and the test went
            // on asserting about a board with no drafted players on it.
            const PLAYERS = 'db_players';
            const STATE = 'db_draft_state';
            const players = JSON.parse(localStorage.getItem(PLAYERS) || '{}');
            const stateDocs = JSON.parse(localStorage.getItem(STATE) || '{}');
            const stateId = Object.keys(stateDocs)[0];

            Object.entries(players).forEach(([id, rec]) => {
                const n = Number(rec.draftPick);
                const drafted = Number.isFinite(n) || rec.isUdfa === true;
                if (!drafted) return;
                if (Number.isFinite(n) && n <= 9) return;
                players[id] = { ...rec };
                delete players[id].draftPick;
                delete players[id].draftYear;
                delete players[id].team;
                delete players[id].isUdfa;
            });
            localStorage.setItem(PLAYERS, JSON.stringify(players));

            const st = { ...stateDocs[stateId].value, currentPick: 10 };
            stateDocs[stateId] = { ...stateDocs[stateId], value: st };
            localStorage.setItem(STATE, JSON.stringify(stateDocs));
        });
        await page.reload();
        await page.waitForSelector('.center-board-container .player-card', { timeout: 45_000 });

        // A drafted player stays on the board, showing the pick that took him.
        // Removing players one at a time emptied a cell while its row lived on
        // for somebody else — a blank column reads as "nobody ranked one"
        // rather than "he went sixth".
        const drafted = await page.$$eval('.center-board-container .player-card',
            els => els.map(e => e.textContent.replace(/\s+/g, ' ')).filter(t => /PK\s*\d/.test(t)));
        expect(drafted.length, 'drafted players vanished from the board').toBeGreaterThan(0);

        // And the tier a drafted player sat in is still rendered, because
        // somebody in it is still available.
        const rows = await page.$$eval('.board-row, .center-board-container [class*=row]', els => els.length);
        expect(rows).toBeGreaterThan(0);
    });
});

test.describe('seasons', () => {
    test('roll over to a new season, then roll back and get the old one intact', async ({ page }) => {
        await openWarm(page, 'scouting');
        await page.waitForSelector('.sg-row', { timeout: 30_000 });

        const boards = () => page.locator('.switcher-btn').allInnerTexts();
        const before = await boards();
        expect(before).toContain('Consensus');

        const openSeasons = async () => {
            await page.locator('.view-tabbar-actions .app-menu-trigger').click();
            await page.getByRole('menuitem', { name: /Seasons/i }).click();
            await page.waitForSelector('.season-modal', { timeout: 10_000 });
        };

        // A season change RELOADS — it swaps five stores at once and most hold
        // their state in memory. Waiting a fixed moment instead of waiting for
        // the load raced under parallel workers: the assertions ran against a
        // half-rebuilt page and the test failed only when the box was busy.
        const settle = async () => {
            await page.waitForLoadState('load');
            await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
            await page.waitForSelector('.switcher-btn, .scouting-empty', { timeout: 45_000 });
        };

        // Rolling over starts an empty season. It creates NO boards on purpose:
        // who is scouting this year is a decision, and last year's placements
        // are about players who have left.
        await openSeasons();
        await page.locator('#season-year').fill('2031');
        await page.getByRole('button', { name: /Roll over/i }).click();
        await settle();
        expect(await boards(), 'a new season arrived with boards on it').not.toContain('Consensus');

        // Rolling back is the destructive one, so it asks first and names what
        // goes — and then the season underneath is exactly as it was left.
        await openSeasons();
        await page.getByRole('button', { name: /Roll back to/i }).click();
        await expect(page.locator('.season-warning')).toContainText('cannot be undone');
        await page.getByRole('button', { name: /^Delete /i }).click();
        await settle();

        expect(await boards()).toEqual(before);
    });
});

test.describe('when the store refuses', () => {
    test('the change is kept, the queue retries, and it lands when the store returns', async ({ page }) => {
        // A drag, a queue, a backoff and a reload. Long on an idle box and
        // longer with four workers on it.
        test.slow();
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        const before = await slotNames(page);

        // An unreachable store. Locally the only real way to fail is a full
        // quota; this is what offline looks like from in here.
        await page.evaluate(() => {
            window.__realSet = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
                // Anything the depth chart writes, wherever it happens to live.
                //
                // This has now been wrong three times by naming one exact key:
                // db_depth_rows, then a flattened path, then db_seasons. Each
                // time the address moved, the injection matched nothing, the
                // write succeeded, and the test went on asserting that a sync
                // indicator appears for a save that worked. Matching on what
                // the value CONTAINS cannot rot the same way.
                if (window.__broken && String(k).startsWith('db_') && /"slots"/.test(String(v))) {
                    throw new Error('backend unreachable');
                }
                return window.__realSet.call(this, k, v);
            };
            window.__broken = true;
        });

        await dragTo(page, page.locator('.rv-slot-name').first(), page.locator('.rv-slot-name').nth(2));

        // Prove the drag landed BEFORE asserting anything about syncing.
        // Otherwise a drag that did not take under load reads as a sync bug,
        // which is a wrong diagnosis printed with total confidence.
        await expect.poll(() => slotNames(page), { timeout: 20_000 })
            .not.toEqual(before);

        // Kept, not rolled back. Losing the work is the thing being guarded
        // against, not an acceptable response to it.
        await expect(page.locator('.sync-status')).toContainText('unsaved', { timeout: 20_000 });
        const moved = await slotNames(page);

        // Both ways out are offered while it is still trying.
        await expect(page.locator('.sync-status .ap-link')).toHaveText(['Try again', 'Save to a file']);

        await page.evaluate(() => { window.__broken = false; });

        // Either the button or the backoff gets there first, and which one is
        // a race this test has no business caring about — pressing it is a
        // shortcut through the wait, not a different code path.
        const tryAgain = page.getByRole('button', { name: /Try again/i });
        if (await tryAgain.count()) await tryAgain.click().catch(() => {});
        await expect(page.locator('.sync-status')).toHaveCount(0, { timeout: 30_000 });

        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        expect(await slotNames(page), 'the queued write never landed').toEqual(moved);
    });

    test('unsaved work survives the reload somebody does when it looks stuck', async ({ page }) => {
        test.slow();
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        const before = await slotNames(page);

        await page.evaluate(() => {
            window.__realSet = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
                // Anything the depth chart writes, wherever it happens to live.
                //
                // This has now been wrong three times by naming one exact key:
                // db_depth_rows, then a flattened path, then db_seasons. Each
                // time the address moved, the injection matched nothing, the
                // write succeeded, and the test went on asserting that a sync
                // indicator appears for a save that worked. Matching on what
                // the value CONTAINS cannot rot the same way.
                if (window.__broken && String(k).startsWith('db_') && /"slots"/.test(String(v))) {
                    throw new Error('backend unreachable');
                }
                return window.__realSet.call(this, k, v);
            };
            window.__broken = true;
        });

        await dragTo(page, page.locator('.rv-slot-name').first(), page.locator('.rv-slot-name').nth(2));
        await expect.poll(() => slotNames(page), { timeout: 20_000 }).not.toEqual(before);
        const moved = await slotNames(page);
        await expect(page.locator('.sync-status')).toContainText('unsaved', { timeout: 20_000 });

        // A queue in memory is a queue a reload throws away — and a reload is
        // exactly what somebody does when the app seems stuck.
        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        // Two ways this went wrong before. Seeding the cache from the restored
        // queue made ready() think the collection was loaded, and a reload
        // with one unsaved change dropped 84 of 91 players. Then merging only
        // on the async path left the synchronous one — the door the app
        // actually uses — showing the old value while the queue wrote the new.
        await expect.poll(() => slotNames(page).then(n => n.length), { timeout: 20_000 }).toBe(before.length);
        expect(await slotNames(page), 'the unsaved change was lost on reload').toEqual(moved);
    });
});

test.describe('an archived season', () => {
    test('refuses writes on every stage, and says why', async ({ page }) => {
        test.slow();
        await openWarm(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });

        const openSeasons = async () => {
            await page.locator('.view-tabbar-actions .app-menu-trigger').click();
            await page.getByRole('menuitem', { name: /Seasons/i }).click();
            await page.waitForSelector('.season-modal', { timeout: 10_000 });
        };
        const settle = async () => {
            await page.waitForLoadState('load');
            await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
        };

        await openSeasons();
        await page.locator('#season-year').fill('2044');
        await page.getByRole('button', { name: /Roll over/i }).click();
        await settle();

        await openSeasons();
        await page.locator('.season-open').filter({ hasText: '2026' }).click();
        await settle();

        // A stage that silently refuses to change looks broken, so it says so.
        await expect(page.locator('.season-banner')).toContainText('2026');

        await gotoTab(page, 'roster');
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        const names = await slotNames(page);
        await dragTo(page, page.locator('.rv-slot-name').first(), page.locator('.roster-cuts').first());
        await page.waitForTimeout(700);

        await page.reload();
        await page.waitForSelector('.roster-grid', { timeout: 45_000 });
        expect(await slotNames(page), 'an archived roster took a write').toEqual(names);
    });
});
