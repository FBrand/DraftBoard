import { test, expect } from '@playwright/test';
import { collection, doc, signInAsExpert, emulatorUp } from './emulator.mjs';

/**
 * The thing this suite has never been able to prove: that a write reached the
 * database.
 *
 * Running anonymously, every write the app makes is absorbed by the local
 * overlay. That is deliberate — it is what lets a viewer build his own mock
 * over an expert's board — but it means a test could watch a change appear on
 * screen and learn nothing at all. A rule refusing the write and a rule
 * accepting it looked exactly the same, and for weeks the shared database sat
 * nearly empty while every browser showed a full app.
 *
 * So these assert against Firestore, read back over REST with the emulator's
 * owner token, which sees what is stored rather than what the page believes.
 */
test.describe('the shared backend', () => {
    // Skipped, not thrown. A suite with an external dependency that FAILS when
    // the dependency is absent makes every other suite's result unreadable —
    // which is what this did to `npm test` for an afternoon. It is its own
    // target now (playwright.shared.config.js); this is the second belt.
    test.beforeAll(async () => {
        test.skip(!await emulatorUp(), 'Firestore emulator not running — npm run emulator');
    });

    test('an expert claiming a board writes the ownership to Firestore', async ({ page }) => {
        const boards = await collection('boards');
        const [danId, dan] = Object.entries(boards).find(([, b]) => b.g === 'dan') ?? [];
        expect(danId, 'the emulator needs seeding: npm run seed:firestore -- --project demo-draftboard --host 127.0.0.1:8080 --wipe').toBeTruthy();

        // Seeded orphaned: an author, and nobody holding it. That is the state
        // a personal board is in before its analyst signs in, and the one
        // state where the rules permit exactly one write — claiming it.
        expect(dan.a, 'dan should have an author').toBeTruthy();
        expect(dan.o, 'dan should start unowned').toBeNull();

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 60_000 });

        // Signed out, an orphaned board is not offered: boardVisible gives it
        // to experts only. Consensus is author-less and therefore public.
        await page.getByRole('button', { name: /Scouting/i }).click();
        await expect(page.locator('.switcher-btn', { hasText: 'Consensus' })).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.switcher-btn', { hasText: 'Dan' })).toHaveCount(0);

        const who = await signInAsExpert(page, 'harness@example.com');
        expect(who.uid).toBeTruthy();

        // A reload rather than waiting on the auth listener: the session is in
        // IndexedDB, and coming up with it is the path a real expert takes.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 60_000 });
        await page.getByRole('button', { name: /Scouting/i }).click();

        // Now it is offered — the same rule, a different identity.
        const danTab = page.locator('.switcher-btn', { hasText: 'Dan' });
        await expect(danTab).toBeVisible({ timeout: 30_000 });
        await danTab.click();

        await page.getByRole('button', { name: /Claim This Board/i }).click();

        // The assertion that matters. Not "the button changed" — the document.
        await expect.poll(async () => (await doc(`boards/${danId}`))?.o, { timeout: 20_000 })
            .toBe(who.uid);
    });

    test('a viewer cannot write an orphaned board, and the database agrees', async ({ page }) => {
        const boards = await collection('boards');
        const [danId] = Object.entries(boards).find(([, b]) => b.g === 'dan') ?? [];
        const before = await doc(`boards/${danId}`);

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 60_000 });
        await page.getByRole('button', { name: /Scouting/i }).click();
        await expect(page.locator('.switcher-btn', { hasText: 'Consensus' })).toBeVisible({ timeout: 30_000 });

        // No Claim control exists for somebody who is not an expert, and the
        // stored document is untouched either way. The second half is the
        // point: the overlay would happily show a viewer his own version.
        await expect(page.getByRole('button', { name: /Claim This Board/i })).toHaveCount(0);
        expect((await doc(`boards/${danId}`))?.o).toBe(before?.o ?? null);
    });
});
