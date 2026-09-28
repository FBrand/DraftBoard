import { defineConfig, devices } from '@playwright/test';

// The fast suite. See tests/fast/core.spec.js for what it covers and why the
// rest moved to Vitest.
//
// Two things make it fast. globalSetup boots the app ONCE and snapshots the
// state it settles on, so no test pays the ~20s cold bootstrap. And the worker
// count is set from the machine rather than from CI being set: the old config
// dropped to two workers under CI=1, which is how an 8-core box ran a browser
// suite on a quarter of itself.
const PORT = process.env.PORT ?? 4173;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests/fast',
    globalSetup: './tests/fast/globalSetup.js',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    // 4 x ~670MB fits the box's ~2.9GB free; CPU is the real limit at 8 cores.
    workers: Number(process.env.WORKERS ?? 4),
    reporter: [['list']],
    // Tight on purpose. A 120s timeout means one hung test costs two minutes
    // of a ten-minute budget; these flows are seconds when they work.
    timeout: 75_000,
    expect: { timeout: 8_000 },
    use: {
        baseURL: BASE_URL,
        trace: 'off',
        screenshot: 'only-on-failure',
        video: 'off',
        actionTimeout: 20_000,
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
    ],
    // Built HERMETICALLY. Never against whatever .env.local points at.
    //
    // `npm run build` reads .env.local, which on this branch names the live
    // project — so this suite was driving production: every run spent real read
    // quota, and any failure might have been the network rather than the code.
    //
    // VITE_BACKEND=local pins it to this browser own storage, which is the
    // right backend for what this suite actually proves: rendering, drag and
    // drop, modals, and work surviving a reload. None of that is about a shared
    // store. `memory` would be the wrong choice — it keeps nothing, and half
    // these tests assert persistence across a reload.
    //
    // Whether a write reaches a SHARED store is a different question with its
    // own suite and its own external dependency: playwright.shared.config.js.
    // Keeping that separate is what stops one missing emulator making every
    // other result unreadable.
    //
    // Its own output directory, so a rebuild can never land in the directory a
    // running preview is already serving from.
    webServer: process.env.NO_WEBSERVER ? undefined : {
        command: `VITE_BACKEND=local VITE_FIREBASE_EMULATOR= VITE_FIREBASE_PROJECT_ID= VITE_FIREBASE_API_KEY= VITE_FIREBASE_AUTH_DOMAIN= VITE_FIREBASE_APP_ID= VITE_FIREBASE_STORAGE_BUCKET= VITE_FIREBASE_MESSAGING_SENDER_ID= npm run build -- --outDir dist-fast && npm run preview -- --outDir dist-fast --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
    },
});
