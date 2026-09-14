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

/**
 * Opens the app with the warm snapshot already in storage.
 *
 * The guard is load-bearing. addInitScript runs before EVERY navigation, not
 * once — so without it a page.reload() re-injected the original snapshot and
 * silently undid whatever the test had just done. Every "and it survives a
 * reload" assertion was really testing the seeding, and failing honestly:
 * the drag had persisted, and then been overwritten.
 *
 * Seeding only into empty storage gives the intended behaviour: the first
 * load starts warm, and every later load sees what the app actually wrote.
 */
export async function openWarm(page, tab) {
    await page.addInitScript((data) => {
        if (localStorage.length > 0) return;
        for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, state());
    await page.goto('/');
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
    if (tab) await gotoTab(page, tab);
}

/** Opens the app with nothing in storage — the cold path. */
export async function openCold(page, tab) {
    await page.goto('/');
    await page.waitForSelector('.view-tabbar', { timeout: 45_000 });
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

/**
 * The same drag, with a finger.
 *
 * dnd-kit runs a separate TouchSensor and it is DELAY-activated (200ms), not
 * distance-activated like the mouse — a quick swipe has to stay a scroll, or
 * the depth chart would be impossible to scroll past on a phone. So a touch
 * drag is press, hold past the delay, then move; anything that taps first
 * cancels the press and the drag never starts.
 *
 * The target is re-measured once the drag is under way, for the same reason
 * dragTo does it: the board auto-scrolls, and a coordinate taken before the
 * press is pointing at the wrong slot by the time the finger arrives.
 */
export async function touchDragTo(page, source, target) {
    const rect = (l) => l.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const centre = (r) => [r.x + r.width / 2, r.y + r.height / 2];

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }],
    });

    const [ax, ay] = centre(await rect(source));
    try {
        await touch('touchStart', ax, ay);
        await page.waitForTimeout(450);
        let [bx, by] = centre(await rect(target));
        for (let i = 1; i <= 16; i++) {
            await touch('touchMove', ax + ((bx - ax) * i) / 16, ay + ((by - ay) * i) / 16);
            await page.waitForTimeout(40);
        }
        await page.waitForTimeout(120);
        [bx, by] = centre(await rect(target));
        await touch('touchMove', bx, by);
        await page.waitForTimeout(150);
        await touch('touchEnd', bx, by);
        await page.waitForTimeout(400);
    } finally {
        if (await page.locator('.rv-drag-overlay').count()) {
            await touch('touchEnd', ax, ay).catch(() => {});
            await page.keyboard.press('Escape').catch(() => {});
        }
    }
}
