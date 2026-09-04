import { defineConfig, devices } from '@playwright/test';

// Tests run against a live dev server, in the official Playwright Docker
// image (which supplies the browsers — the npm package here is installed with
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, since this host is memory-constrained).
// See `npm run test` / `npm run test:docker` in package.json.
const PORT = process.env.PORT ?? 5173;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests',
    // The app's state is global (localStorage), and several specs deliberately
    // wipe or restore all of it. Running them in parallel would have them
    // clobbering each other, so this suite is serial by design.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? [['list'], ['github']] : [['list']],
    // Generous: these are full-app flows against a dev server, and some seed a
    // roster, reload, and drag across a wide grid within a single test.
    timeout: 120_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: BASE_URL,
        // Traces are off by default: the suite normally runs with the repo
        // bind-mounted into the Playwright container, where writing the trace
        // archive is both slow and unreliable. Turn on per-run when debugging
        // a failure: `npx playwright test --trace on`.
        trace: 'off',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [
        {
            name: 'desktop',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
            testIgnore: /\.mobile\.spec\.js$/,
        },
        {
            name: 'mobile',
            use: { ...devices['Pixel 7'] },
            testMatch: /\.mobile\.spec\.js$/,
        },
    ],
    // Reuses an already-running dev server when there is one (the usual case
    // during development); starts one otherwise.
    webServer: process.env.NO_WEBSERVER ? undefined : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
