import { test } from '@playwright/test';
import { expect, openWarm } from './helpers';

/**
 * A roster drag with a FINGER.
 *
 * Every other drag in the suite goes through `page.mouse`, and @dnd-kit's
 * TouchSensor is a different code path from MouseSensor — delay-activated
 * (200ms, 8px tolerance) rather than distance-activated, so that a quick swipe
 * scrolls the chart instead of carrying a player off. The drag-and-drop was
 * rewritten on dnd-kit precisely for touch, and nothing automated had ever
 * exercised that half.
 *
 * Playwright's touchscreen only taps, so the gesture is dispatched over CDP:
 * press, HOLD past the activation delay, move, lift. Skipped where there is no
 * touchscreen, so this is a phone-project test that costs the desktop run
 * nothing.
 */
const hasTouch = (page) => page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);

test('roster: a finger can drag a player, and a quick swipe still scrolls', async ({ page }) => {
    await openWarm(page, 'roster');
    await page.waitForSelector('.roster-grid', { timeout: 45_000 });
    test.skip(!(await hasTouch(page)), 'no touchscreen in this project');

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1 }],
    });
    async function fingerDrag(from, to, { hold = 350, steps = 14 } = {}) {
        await touch('touchStart', from.x, from.y);
        await page.waitForTimeout(hold);
        for (let i = 1; i <= steps; i += 1) {
            await touch('touchMove', from.x + (to.x - from.x) * (i / steps), from.y + (to.y - from.y) * (i / steps));
            await page.waitForTimeout(40);
        }
        await page.waitForTimeout(200);
        await touch('touchEnd', to.x, to.y);
        await page.waitForTimeout(1_200);
    }

    const onRoster = () => page.evaluate(() => {
        const cuts = new Set(document.querySelectorAll('.roster-cuts-list .rv-slot-name'));
        return [...document.querySelectorAll('.rv-slot-name')].filter(e => !cuts.has(e)).map(e => e.textContent.trim());
    });

    // Two filled slots fully on screen on BOTH axes — the depth chart scrolls
    // sideways, so the first empty slot in DOM order sits off the side of a
    // 390px display, and dragging to a coordinate that is not on the screen
    // proves nothing.
    const visible = await page.evaluate(() => [...document.querySelectorAll('.rv-slot')]
        .map((el, i) => ({ el, i }))
        .filter(({ el }) => {
            if (!el.querySelector('.rv-slot-name') || el.closest('.roster-cuts') || el.closest('.roster-ir')) return false;
            const r = el.getBoundingClientRect();
            return r.top > 0 && r.bottom < window.innerHeight && r.left > 0 && r.right < window.innerWidth;
        })
        .map(({ i }) => i));
    expect(visible.length, 'fewer than two slots fully visible at this width').toBeGreaterThanOrEqual(2);

    const nameAt = (i) => page.locator('.rv-slot').nth(i).locator('.rv-slot-name').innerText().then(t => t.trim());
    const centre = (i) => page.locator('.rv-slot').nth(i)
        .evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

    const before = await onRoster();
    const aName = await nameAt(visible[0]);
    const bName = await nameAt(visible[1]);

    await fingerDrag(await centre(visible[0]), await centre(visible[1]));

    const aAfter = await nameAt(visible[0]);
    const bAfter = await nameAt(visible[1]);
    expect(`${aAfter}|${bAfter}`, 'a finger drag changed nothing').not.toBe(`${aName}|${bName}`);
    expect(await onRoster(), 'a drag must move a player, not add or lose one').toHaveLength(before.length);

    // A quick swipe is how the chart is scrolled; it must not carry anybody.
    const stillThere = await nameAt(visible[0]);
    const c = await centre(visible[0]);
    await fingerDrag(c, { x: c.x, y: c.y - 220 }, { hold: 60, steps: 6 });
    expect(await onRoster(), 'a quick swipe dragged a player instead of scrolling').toContain(stillThere);
});
