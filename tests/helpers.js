import { expect } from '@playwright/test';

export const TABS = {
    fa: '💰 Free Agency',
    scouting: '🔎 Scouting',
    draft: '📋 Draft Board',
    udfa: '🪧 UDFA',
    roster: '🏈 Roster',
};

// localStorage keys the app owns — kept in sync with src/utils/appSession.js.
export const STORAGE_KEYS = {
    draft: 'nfl_draft_board_state',
    roster: 'rosterState',
    fa: 'fa_state_v1',
    scoutingConsensus: 'scouting_overlay_v1__consensus',
    view: 'draft_board_view',
    focus: 'draft_board_focus',
};

/**
 * Fresh app with empty state. Playwright gives each test its own context, so
 * localStorage starts empty anyway — this exists to make that explicit and to
 * land on a known tab.
 */
export async function openApp(page, tab) {
    await page.goto('/');
    await page.waitForSelector('.view-tabbar');
    if (tab) await gotoTab(page, tab);
}

export async function gotoTab(page, tab) {
    await page.getByRole('button', { name: TABS[tab], exact: true }).click();
    await page.waitForTimeout(400);
}

// Loading the default roster fetches and renders ~90 slots, which costs
// roughly 20s. Tests that seed a row then reload would pay that two or three
// times over. The resulting state is deterministic, so the first load in a
// worker is cached and every later call just writes it straight to
// localStorage. Workers are pinned to 1 (see playwright.config.js), so this
// cache is shared by the whole run.
let cachedRosterState = null;

/** Roster shows a bootstrap screen until it has data; load the default. */
export async function ensureRoster(page) {
    await gotoTab(page, 'roster');

    if (cachedRosterState) {
        const current = await page.evaluate(k => localStorage.getItem(k), STORAGE_KEYS.roster);
        if (current === null) {
            await page.evaluate(
                ([k, v]) => localStorage.setItem(k, v),
                [STORAGE_KEYS.roster, cachedRosterState],
            );
            await page.reload();
            await gotoTab(page, 'roster');
        }
    } else {
        const bootstrap = page.getByRole('button', { name: 'Load Default Roster' });
        if (await bootstrap.count()) {
            await bootstrap.click();
            await page.waitForSelector('.roster-grid', { timeout: 30_000 });
            cachedRosterState = await page.evaluate(k => localStorage.getItem(k), STORAGE_KEYS.roster);
        }
    }

    await expect(page.locator('.roster-grid').first()).toBeVisible();
    await page.waitForTimeout(200);
}

/** Names currently rendered in depth-chart slots. */
export function slotNames(page) {
    return page.$$eval('.rv-slot-name', els => els.map(e => e.textContent));
}

/**
 * Drag one element onto another using real mouse events.
 *
 * Two things make this fiddly and both are handled here:
 *  - dnd-kit's MouseSensor activates only after 8px of movement, so the drag
 *    has to move in steps; a single jump never registers as a drag.
 *  - once dragging, dnd-kit auto-scrolls the container when the pointer nears
 *    an edge, which moves the target out from under the coordinates measured
 *    before the drag started. Dropping on stale coordinates leaves the drag
 *    unfinished with the pointer still captured, which then blocks every
 *    later interaction in the test. So the target is re-measured after the
 *    approach and the pointer nudged onto its current position before
 *    releasing.
 */
export async function dragTo(page, source, target) {
    // Raw rect read: Locator.boundingBox() waits for the element to be
    // "stable", and dnd-kit auto-scrolls continuously while a drag is in
    // flight, so mid-drag that wait never resolves. evaluate() only needs the
    // element attached.
    const rect = (locator) => locator.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];

    const sb = await rect(source);
    const approach = await rect(target);

    try {
        await page.mouse.move(...center(sb));
        await page.mouse.down();
        await page.waitForTimeout(80);
        // Step, don't jump: MouseSensor only activates after 8px of movement.
        await page.mouse.move(...center(approach), { steps: 20 });
        await page.waitForTimeout(150);

        // Re-measure: auto-scroll may have moved the target out from under the
        // coordinates measured before the drag began.
        const settled = await rect(target).catch(() => null);
        if (settled && settled.width > 0) {
            await page.mouse.move(...center(settled), { steps: 6 });
            await page.waitForTimeout(150);
        }
        await page.mouse.up();
        await page.waitForTimeout(400);
    } finally {
        // Never leave a drag in flight: a captured pointer plus running
        // auto-scroll makes every later action in the test time out waiting
        // for something to become "stable".
        if (await page.locator('.rv-drag-overlay').count()) {
            await page.mouse.up().catch(() => {});
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(200);
        }
    }
}

/**
 * Writes a known depth-chart row directly to localStorage, so tests can set up
 * awkward shapes (holes mid-array) that would be tedious to build by dragging.
 * Returns the row id it wrote to. Caller must reload afterwards.
 */
export async function seedRosterRow(page, buildSlots) {
    return page.evaluate(({ key, fnBody }) => {
        const st = JSON.parse(localStorage.getItem(key));
        const chip = st.positionConfig.offense[0];
        const s53 = Math.max(chip.slots53, 1);
        const build = new Function('s53', 'PS_SLOTS', fnBody);
        st.depthChart[chip.id] = build(s53, 3);
        localStorage.setItem(key, JSON.stringify(st));
        return { rowId: chip.id, label: chip.label, s53 };
    }, { key: STORAGE_KEYS.roster, fnBody: `return (${buildSlots.toString()})(s53, PS_SLOTS);` });
}

/** Collects console errors and page exceptions for assertions. */
export function trackErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(`exception: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    // A native dialog means we regressed back to window.alert/confirm/prompt,
    // which this app deliberately does not use (it's a broadcast tool).
    page.on('dialog', async d => {
        errors.push(`native dialog (${d.type()}): ${d.message()}`);
        await d.dismiss();
    });
    return errors;
}
