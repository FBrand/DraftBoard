import { defineConfig, devices } from '@playwright/test';

/**
 * The shared-backend suite. Separate from the fast suite on purpose.
 *
 * These are the only tests that can tell a working backend from a dead one:
 * they read Firestore back over REST and assert what is STORED, not what the
 * page believes. That requires the emulator, a seeded project and a build
 * pointed at both — three preconditions the fast suite must not inherit.
 *
 * It lived in tests/fast for one afternoon and broke `npm test` for anyone
 * without the emulator running, which is the failure this file exists to stop:
 * a suite with an external dependency must be its own target, so the default
 * one stays hermetic.
 *
 *   npm run emulator
 *   npm run seed:firestore -- --project demo-draftboard --host 127.0.0.1:8080 --wipe
 *   npm run build:firebase && npx vite preview --outDir dist-fb --port 4173
 *   npm run test:shared
 */
const PORT = process.env.PORT ?? 4173;

export default defineConfig({
    testDir: './tests/shared',
    fullyParallel: false,
    retries: 0,
    workers: 1,
    reporter: [['list']],
    timeout: 90_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
        trace: 'off',
        screenshot: 'only-on-failure',
        actionTimeout: 20_000,
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
    ],
});
