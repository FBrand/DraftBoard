import { defineConfig, devices } from '@playwright/test';
import base from './playwright.fast.config.js';

/**
 * The fast suite's flows, driven at 390px with a real touchscreen.
 *
 * Not a second suite — the same specs, on the device the user reports bugs
 * from. 38 of 47 pass; the nine that do not are mostly one device mismatch —
 * the player card opens as a modal at this width, so a spec that clicks where
 * the side panel would be is blocked by the overlay. The desktop project proves a flow works with a mouse; this asks
 * whether the same flow is reachable and correct with a finger, where panels
 * are off-canvas behind toggles and a tap carries no hover.
 */
export default defineConfig({
    ...base,
    // Fewer workers than the desktop project: rendering a thousand cards at
    // 390px is heavier than at 1600px.
    workers: Number(process.env.WORKERS ?? 2),
    projects: [
        { name: 'phone', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    ],
});
