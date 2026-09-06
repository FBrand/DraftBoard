/**
 * Boots the app once for the whole run and snapshots the state it settles on.
 *
 * The old suite paid this per test. A cold start fetches three rankings files,
 * a 91-slot roster, the facts seed and the draft, resolves ~700 players into
 * the registry and writes the lot — roughly 20 seconds, times 87 tests, on two
 * workers. That bootstrap is the same every time and is itself covered by the
 * unit tests, so paying for it repeatedly bought nothing.
 *
 * Every test then injects this snapshot before page scripts run, and opens on
 * an app that is already warm. Tests that need a cold or wiped app clear
 * storage themselves — see `openCold` in helpers.
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SNAPSHOT_PATH = 'test-results/.state-snapshot.json';

export default async function globalSetup(config) {
    const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:4173';
    const browser = await chromium.launch();
    const page = await browser.newPage({ baseURL });

    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.view-tabbar', { timeout: 60_000 });

    // Visit the two tabs that bootstrap their own state, so the snapshot
    // contains a loaded roster and free-agency board rather than just the
    // draft. Roster is the slow one and the reason this file exists.
    await page.getByRole('button', { name: '🏈 Roster', exact: true }).click();
    await page.waitForSelector('.roster-grid', { timeout: 60_000 });
    await page.getByRole('button', { name: '💰 Free Agency', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: '🔎 Scouting', exact: true }).click();
    await page.waitForTimeout(1500);

    const state = await page.evaluate(() => Object.fromEntries(
        Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]),
    ));

    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(state));
    console.log(`[globalSetup] snapshot: ${Object.keys(state).length} keys`);

    await browser.close();
}
