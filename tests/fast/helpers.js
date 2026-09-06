import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { SNAPSHOT_PATH } from './globalSetup';

export const TABS = {
    fa: '💰 Free Agency',
    scouting: '🔎 Scouting',
    draft: '📋 Draft Board',
    udfa: '🪧 UDFA',
    roster: '🏈 Roster',
};

let snapshot = null;
const state = () => (snapshot ??= JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')));

/** Opens the app with the warm snapshot already in storage. */
export async function openWarm(page, tab) {
    await page.addInitScript((data) => {
        for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, state());
    await page.goto('/');
    await page.waitForSelector('.view-tabbar');
    if (tab) await gotoTab(page, tab);
}

/** Opens the app with nothing in storage — the cold path. */
export async function openCold(page, tab) {
    await page.goto('/');
    await page.waitForSelector('.view-tabbar');
    if (tab) await gotoTab(page, tab);
}

export async function gotoTab(page, tab) {
    await page.getByRole('button', { name: TABS[tab], exact: true }).click();
    await page.waitForTimeout(250);
}

export function slotNames(page) {
    return page.$$eval('.rv-slot-name', els => els.map(e => e.textContent));
}

/**
 * Drag with real mouse events. dnd-kit's MouseSensor needs 8px of movement to
 * activate, and auto-scrolls once dragging — so the target is re-measured
 * before release, and an in-flight drag is always cancelled on the way out.
 * (Carried over from the original suite; this part is genuinely fiddly.)
 */
export async function dragTo(page, source, target) {
    const rect = (l) => l.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];

    const sb = await rect(source);
    const approach = await rect(target);
    try {
        await page.mouse.move(...center(sb));
        await page.mouse.down();
        await page.waitForTimeout(60);
        await page.mouse.move(...center(approach), { steps: 16 });
        await page.waitForTimeout(120);
        const settled = await rect(target).catch(() => null);
        if (settled?.width > 0) {
            await page.mouse.move(...center(settled), { steps: 5 });
            await page.waitForTimeout(120);
        }
        await page.mouse.up();
        await page.waitForTimeout(300);
    } finally {
        if (await page.locator('.rv-drag-overlay').count()) {
            await page.mouse.up().catch(() => {});
            await page.keyboard.press('Escape').catch(() => {});
        }
    }
}

/** Console errors, page exceptions, and native dialogs (which this app never uses). */
export function trackErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(`exception: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('dialog', async d => {
        errors.push(`native dialog (${d.type()}): ${d.message()}`);
        await d.dismiss();
    });
    return errors;
}

export { expect };
