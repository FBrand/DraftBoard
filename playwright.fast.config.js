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
    workers: Number(process.env.WORKERS ?? 3),
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
    webServer: process.env.NO_WEBSERVER ? undefined : {
        command: `npm run build && npm run preview -- --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
    },
});
