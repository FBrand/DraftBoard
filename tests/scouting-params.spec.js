import { test, expect } from '@playwright/test';
import { openApp, gotoTab, trackErrors } from './helpers.js';

// Scouting's Total Rank and Round.Group are the board's own overallRank and
// group — the same parameters CenterBoard places cards by and the exported
// rankings CSV carries into the draft board and roster import. These guard
// that they stay wired together rather than drifting back into a parallel,
// display-only set of fields.
// Names come from the card's own .player-name node; taking the last line of
// innerText picks up the position badge instead on some cards.
const topNames = (page, n) => page.$$eval('.scouting-rank-row',
    (rows, count) => rows.slice(0, count)
        .map(r => r.querySelector('.player-name')?.textContent.trim()), n);

test.describe('scouting fields drive the real board parameters', () => {
    test('fields are prefilled from the board, not blank', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        const card = page.locator('.center-board-container .player-card').first();
        const shownRank = (await card.locator('.player-rank').innerText()).replace('#', '').trim();
        await card.click();

        // Total Rank reflects the player's current rank instead of an empty box.
        await expect(page.locator('.scouting-number-grid input').first()).toHaveValue(shownRank);
        // Round and tier are two inputs now, both prefilled from the player's
        // current tier rather than shown blank.
        const groupInputs = page.locator('.scouting-group-fields input');
        await expect(groupInputs).toHaveCount(2);
        await expect(groupInputs.first()).not.toHaveValue('');
        // Position rank is derived, so it's shown but not typeable.
        await expect(page.locator('.scouting-derived-value')).toHaveCount(1);
        await expect(page.locator('.scouting-derived-value')).not.toBeEmpty();
    });

    test('total rank follows the subgroups: 1.2 always outranks 1.3', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        // Read every row's tier in board order; tiers must be non-decreasing,
        // i.e. nobody in a later tier outranks anybody in an earlier one.
        const tiers = await page.$$eval('.scouting-rank-row', rows => rows
            .map(r => r.querySelector('.scouting-rank-group')?.textContent?.trim())
            .filter(Boolean));

        const key = (g) => {
            const m = g.match(/^(\d+)(?:\.(\d+))?/);
            return m ? [Number(m[1]), Number(m[2] ?? 0)] : [Infinity, 0];
        };
        for (let i = 1; i < tiers.length; i++) {
            const [pr, pt] = key(tiers[i - 1]);
            const [cr, ct] = key(tiers[i]);
            expect(pr < cr || (pr === cr && pt <= ct)).toBe(true);
        }
    });

    test('position rank is computed per position from the same order', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        // Walk the board order and check the first QB seen is QB1, the second QB2.
        const seen = [];
        const rows = page.locator('.scouting-rank-row');
        const total = Math.min(await rows.count(), 40);
        for (let i = 0; i < total && seen.length < 2; i++) {
            const pos = await rows.nth(i).locator('.player-pos').innerText().catch(() => '');
            if (pos.split('.')[0] === 'QB') seen.push(i);
        }
        test.skip(seen.length < 2, 'need two QBs near the top of the board');

        for (const [n, rowIdx] of seen.entries()) {
            await rows.nth(rowIdx).locator('.scouting-rank-card').click();
            await page.waitForTimeout(300);
            await expect(page.locator('.scouting-derived-value')).toHaveText(String(n + 1));
        }
    });

    test('changing Round.Group moves the player on the board', async ({ page }) => {
        const errors = trackErrors(page);
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        const card = page.locator('.center-board-container .player-card').first();
        const name = (await card.innerText()).split('\n').pop().trim();
        await card.click();

        const groupInputs = page.locator('.scouting-group-fields input');
        const originalGroup = await groupInputs.first().inputValue();

        // Move the player to a clearly different round.
        await groupInputs.first().fill('7');
        await groupInputs.nth(1).fill('1');
        await groupInputs.nth(1).blur();
        await page.waitForTimeout(600);

        // The board now renders that player under round 7, not their old one.
        const rowOfPlayer = await page.evaluate((playerName) => {
            const cardEl = [...document.querySelectorAll('.center-board-container .player-card')]
                .find(el => el.innerText.includes(playerName));
            if (!cardEl) return null;
            return getComputedStyle(cardEl.closest('.slot-cell')).gridRowStart;
        }, name);
        expect(rowOfPlayer).not.toBeNull();

        // The ranked list badge tracks it too.
        await expect(page.locator('.scouting-rank-row', { hasText: name })
            .locator('.scouting-rank-group')).toHaveText('7.1');

        expect(originalGroup).not.toBe('7');
        expect(errors).toEqual([]);
    });

    test('setting a rank shifts the others instead of duplicating it', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        // A rank is a position in an ordering, so no two players may hold the
        // same one. Moving the 4th player to rank 2 must push the old 2nd and
        // 3rd down one each, leaving 1st and 5th untouched.
        const before = await topNames(page, 5);

        await page.locator('.scouting-rank-row').nth(3).locator('.scouting-rank-card').click();
        await page.waitForTimeout(300);
        const rankInput = page.locator('.scouting-number-grid input').first();
        await rankInput.fill('2');
        await rankInput.blur();
        await page.waitForTimeout(700);

        const after = await topNames(page, 5);
        expect(after).toEqual([before[0], before[3], before[1], before[2], before[4]]);

        // Ranks stay unique and contiguous — no two players share a number.
        const shown = await page.$$eval('.scouting-rank-num',
            els => els.slice(0, 5).map(e => e.textContent.trim()));
        expect(shown).toEqual(['1', '2', '3', '4', '5']);

        // The board card reflects the same field.
        const boardRank = await page.evaluate((playerName) => {
            const el = [...document.querySelectorAll('.center-board-container .player-card')]
                .find(e => e.querySelector('.player-name')?.textContent.trim() === playerName);
            return el?.querySelector('.player-rank')?.textContent?.trim();
        }, before[3]);
        expect(boardRank).toBe('#2');
    });

    test('round subgroup rows stay in tier order', async ({ page }) => {
        // Regression: subgroup row order used to depend on the order players
        // happened to arrive in, so ranking players re-sorted the rows.
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        const readRounds = () => page.$$eval('.round-sidebar-label',
            els => els.map(e => e.textContent.trim()).filter(Boolean));

        const before = await readRounds();
        expect(before).toEqual([...before].sort((a, b) => Number(a) - Number(b)));

        // Re-rank someone, then confirm the rows are still in order.
        await page.locator('.scouting-rank-row').nth(4).locator('.scouting-rank-card').click();
        await page.waitForTimeout(300);
        const rankInput = page.locator('.scouting-number-grid input').first();
        await rankInput.fill('1');
        await rankInput.blur();
        await page.waitForTimeout(700);

        const after = await readRounds();
        expect(after).toEqual([...after].sort((a, b) => Number(a) - Number(b)));
    });

    test('board CSV export carries the edited values and the whole board', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        const totalPlayers = await page.locator('.scouting-rank-row').count();

        const card = page.locator('.center-board-container .player-card').first();
        const name = (await card.innerText()).split('\n').pop().trim();
        await card.click();
        const gi = page.locator('.scouting-group-fields input');
        await gi.first().fill('7');
        await gi.nth(1).fill('1');
        await gi.nth(1).blur();
        await page.waitForTimeout(500);

        await page.locator('.top-actions .app-menu-trigger').click();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('menuitem', { name: /Export as Board CSV/ }).click(),
        ]);
        const stream = await download.createReadStream();
        const text = await new Promise(res => {
            let d = '';
            stream.on('data', c => { d += c; });
            stream.on('end', () => res(d));
        });

        const lines = text.trim().split('\n');
        expect(lines[0]).toBe('group,name,position');

        // Every player on the board is exported, not only the edited ones —
        // an entries-only export used to silently drop the untouched majority.
        expect(lines.length - 1).toBe(totalPlayers);

        const row = lines.find(l => l.includes(name));
        expect(row).toBeDefined();
        expect(row.startsWith('7.1,')).toBe(true);
    });
});

test.describe('athletic matrix credit', () => {
    test('links to the Athletic Matrix only once a player has matrix values', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        const credit = page.locator('.scouting-matrix-credit');
        await page.locator('.center-board-container .player-card').first().click();
        await expect(credit).toHaveCount(0);

        // Inputs are: Total Rank, Athletic Matrix (Total), Athletic Matrix (Pos)
        // — Position Rank is derived and rendered as text, not an input.
        const matrix = page.locator('.scouting-number-grid input').nth(1);
        await matrix.fill('92');
        await matrix.blur();
        await page.waitForTimeout(500);

        await expect(credit).toBeVisible();
        await expect(credit).toHaveText('Get your Athletic Matrix copy here.');
        await expect(credit).toHaveAttribute('href',
            'https://www.rogueapc.com/store/p21/The_2026_Athletic_Matrix.html');
        await expect(credit).toHaveAttribute('rel', /noopener/);
    });
});

test.describe('configurable Athletic Matrix link', () => {
    // Seeds a player with matrix values so the credit line renders.
    async function withMatrixValue(page, url) {
        await page.goto(url);
        await page.waitForSelector('.view-tabbar');
        await gotoTab(page, 'scouting');
        await page.waitForSelector('.scouting-layout');
        await page.locator('.center-board-container .player-card').first().click();
        const matrix = page.locator('.scouting-number-grid input').nth(1);
        await matrix.fill('92');
        await matrix.blur();
        await page.waitForTimeout(500);
    }

    test('?matrixUrl= overrides the link and is remembered', async ({ page }) => {
        await withMatrixValue(page, '/?matrixUrl=https%3A%2F%2Fexample.com%2Fmatrix');
        await expect(page.locator('.scouting-matrix-credit'))
            .toHaveAttribute('href', 'https://example.com/matrix');

        // Sticks without needing the parameter on every subsequent link.
        await page.goto('/');
        await gotoTab(page, 'scouting');
        await page.waitForSelector('.scouting-layout');
        await page.locator('.center-board-container .player-card').first().click();
        await expect(page.locator('.scouting-matrix-credit'))
            .toHaveAttribute('href', 'https://example.com/matrix');
    });

    test('rejects a non-http scheme rather than putting it in the href', async ({ page }) => {
        // The value reaches an href and one source is a query parameter, so a
        // javascript: URL would be script injection dressed up as config.
        await withMatrixValue(page, '/?matrixUrl=javascript%3Aalert(1)');
        const href = await page.locator('.scouting-matrix-credit').getAttribute('href');
        expect(href.startsWith('https://')).toBe(true);
        expect(href).not.toContain('javascript');
    });
});

test.describe('info card ranks are board-specific', () => {
    test('paging boards re-ranks the player under that board', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-layout');

        // Give the Consensus board a distinctive ordering: promote the 6th
        // player to the top. Dan's board is left untouched.
        const rows = page.locator('.scouting-rank-row');
        const name = await rows.nth(5).locator('.player-name').innerText();
        await rows.nth(5).locator('.scouting-rank-card').click();
        await page.waitForTimeout(300);
        const rankInput = page.locator('.scouting-number-grid input').first();
        await rankInput.fill('1');
        await rankInput.blur();
        await page.waitForTimeout(700);

        await expect(rows.first().locator('.player-name')).toHaveText(name);

        // Now open the read-only card for that player from the draft board.
        // Full Board (focus mode) shows every player including drafted ones —
        // the default Normal view hides them, and a seeded session can have
        // most of the pool already drafted.
        await gotoTab(page, 'draft');
        await page.waitForTimeout(600);
        const focus = page.getByRole('button', { name: /Full Board/ });
        if (await focus.count()) {
            await focus.click();
            await page.waitForTimeout(600);
        }
        const opened = await page.evaluate((playerName) => {
            const el = [...document.querySelectorAll('.center-board-container .player-card')]
                .find(e => e.querySelector('.player-name')?.textContent.trim() === playerName);
            if (!el) return false;
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
            return true;
        }, name);
        test.skip(!opened, 'player not visible on the draft board');

        const box = page.locator('.scouting-modal-box');
        await expect(box).toBeVisible();
        await expect(box.locator('.scouting-board-pager span')).toHaveText(/CONSENSUS/i);

        const totalRankOn = async () =>
            (await box.locator('.scouting-readonly-value').first().innerText()).trim();

        // Consensus has them at #1 because we just put them there.
        expect(await totalRankOn()).toBe('1');

        // Dan's board never got that edit, so the same player ranks elsewhere.
        await box.getByRole('button', { name: 'Next board' }).click();
        await page.waitForTimeout(500);
        await expect(box.locator('.scouting-board-pager span')).toHaveText(/DAN/i);
        expect(await totalRankOn()).not.toBe('1');

        // ...and paging back restores the Consensus number.
        await box.getByRole('button', { name: 'Previous board' }).click();
        await page.waitForTimeout(500);
        expect(await totalRankOn()).toBe('1');
    });
});

test.describe('each board has its own player pool', () => {
    // The three analysts keep separate rankings files with different players,
    // tiers and order. Switching board has to switch the pool, not just lay a
    // different overlay over one shared list — otherwise every board reports
    // the same rank for the same player.
    test('switching board changes the ranked list', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        const top = () => page.$$eval('.scouting-rank-row',
            rows => rows.slice(0, 10).map(r => r.querySelector('.player-name')?.textContent.trim()));
        const count = () => page.locator('.scouting-rank-row').count();

        const consensus = await top();
        const consensusCount = await count();

        await page.locator('.board-switcher .switcher-btn', { hasText: 'Dan' }).click();
        await page.waitForTimeout(800);
        const dan = await top();

        expect(dan).not.toEqual(consensus);
        // Different files hold different numbers of players, too.
        expect(await count()).not.toBe(consensusCount);
    });

    test('shared players rank differently on each board, with no edits', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');

        // Asserting on one hand-picked player is brittle — any given player can
        // legitimately sit at the same number on two boards. The real invariant
        // is that the boards disagree about *someone*.
        const ranksByName = () => page.$$eval('.scouting-rank-row', rows =>
            Object.fromEntries(rows.slice(0, 40).map(r => [
                r.querySelector('.player-name')?.textContent.trim(),
                r.querySelector('.scouting-rank-num')?.textContent.trim(),
            ]).filter(([n]) => n)));

        const consensus = await ranksByName();

        await page.locator('.board-switcher .switcher-btn', { hasText: 'Ryan' }).click();
        await page.waitForTimeout(800);
        const ryan = await ranksByName();

        const shared = Object.keys(consensus).filter(n => n in ryan);
        expect(shared.length).toBeGreaterThan(0);

        const disagreements = shared.filter(n => consensus[n] !== ryan[n]);
        expect(disagreements.length).toBeGreaterThan(0);
    });
});

test.describe('read-only card shows remarks from every board', () => {
    test('groups by analyst with +/-/dot symbols and no field headers', async ({ page }) => {
        await openApp(page, 'scouting');
        await page.waitForSelector('.scouting-rank-row');
        const name = await page.locator('.scouting-rank-row').first().locator('.player-name').innerText();

        const addRemarks = async (board, strength, weakness, note) => {
            await page.locator('.board-switcher .switcher-btn', { hasText: board }).click();
            await page.waitForTimeout(700);
            const row = page.locator('.scouting-rank-row', { hasText: name }).first();
            if (!await row.count()) return false;
            await row.locator('.scouting-rank-card').click();
            await page.waitForTimeout(400);
            const fields = page.locator('.scouting-list-field');
            for (const [i, text] of [strength, weakness, note].entries()) {
                await fields.nth(i).locator('input').fill(text);
                await fields.nth(i).getByRole('button', { name: '+' }).click();
            }
            await page.waitForTimeout(400);
            return true;
        };

        await addRemarks('Consensus', 'Elite burst', 'Small hands', 'Check tape vs zone');
        const onDan = await addRemarks('Dan', 'Great motor', 'Raw technique', 'Rising fast');

        // Open the read-only card outside Scouting.
        await gotoTab(page, 'draft');
        await page.waitForTimeout(600);
        const focus = page.getByRole('button', { name: /Full Board/ });
        if (await focus.count()) { await focus.click(); await page.waitForTimeout(600); }

        const opened = await page.evaluate((n) => {
            const el = [...document.querySelectorAll('.center-board-container .player-card')]
                .find(e => e.querySelector('.player-name')?.textContent.trim() === n);
            if (!el) return false;
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
            return true;
        }, name);
        test.skip(!opened, 'player not on the draft board');

        const box = page.locator('.scouting-modal-box');
        await expect(box).toBeVisible();

        // Headed by the analyst, not by "Strengths"/"Weaknesses"/"Notes".
        await expect(box.locator('.scouting-list-label')).toHaveCount(0);
        const headers = await box.locator('.scouting-board-notes-header').allTextContents();
        expect(headers).toContain('Consensus');
        if (onDan) expect(headers).toContain('Dan');
        // Boards with nothing to say are omitted.
        expect(headers).not.toContain('Ryan');

        // Each remark carries the symbol for its kind.
        const consensus = box.locator('.scouting-board-notes-group').first();
        await expect(consensus.locator('.scouting-remark.strength .scouting-remark-symbol').first()).toHaveText('+');
        await expect(consensus.locator('.scouting-remark.weakness .scouting-remark-symbol').first()).toHaveText('−');
        await expect(consensus.locator('.scouting-remark.note .scouting-remark-symbol').first()).toHaveText('•');
        await expect(consensus.locator('li', { hasText: 'Elite burst' })).toBeVisible();

        // Remarks from every board show at once, without paging.
        if (onDan) await expect(box.locator('li', { hasText: 'Great motor' })).toBeVisible();
    });
});
