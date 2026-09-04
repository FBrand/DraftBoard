import { defineConfig, devices } from '@playwright/test';

// Tests run against a PRODUCTION build (vite preview), in the official
// Playwright Docker image (which supplies the browsers — the npm package here
// is installed with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, since this host is
// memory-constrained). See `npm run test` / `npm run test:docker`.
//
// Not the dev server: Vite serves ~55 unbundled, unminified modules including
// React's development build, and every test pays that cost again on its own
// page load. Measured, the same 62 tests took 40.1 min against the dev server
// with one worker and 10.5 min here. It also means the suite exercises what
// actually ships.
const PORT = process.env.PORT ?? 4173;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests',
    // Playwright gives every test its own browser context, and localStorage is
    // per-context — so the specs that deliberately wipe and restore all app
    // state cannot reach each other, and the suite parallelises safely. (This
    // was previously pinned to one worker on the mistaken belief that they
    // shared storage.)
    //
    // Three saturates a 4-core box: measured 674 MB average container memory,
    // ~260% CPU, and no additional swapping. Memory is not the limit here; CPU
    // is, so a fourth worker buys little.
    workers: process.env.CI ? 2 : 3,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? [['list'], ['github']] : [['list']],
    // Generous: these are full-app flows, and some seed a roster, reload, and
    // drag across a wide grid within a single test — under three workers on a
    // loaded box, individual tests get slower even as the suite gets faster.
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
    // Builds and serves the production bundle. Reuses an already-running
    // preview server when there is one. Set NO_WEBSERVER=1 to point at a
    // server you started yourself.
    webServer: process.env.NO_WEBSERVER ? undefined : {
        command: 'npm run build && npm run preview -- --port ' + PORT,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
    },
});
