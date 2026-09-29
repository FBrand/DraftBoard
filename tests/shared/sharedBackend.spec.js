import { test, expect } from '@playwright/test';
import { collection, collectionGroup, doc, orphanBoard, remove, signInAsExpert, emulatorUp } from './emulator.mjs';

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

    // These tests write to the project they read, so the state they leave is
    // the state the next run starts from — the claim test passed once and then
    // failed against its own leftovers, and the test behind it failed for a
    // reason that had nothing to do with what it was testing. Each run puts
    // the board back rather than inheriting whatever was left.
    test.beforeEach(async () => {
        const boards = await collection('boards');
        const [danId] = Object.entries(boards).find(([, b]) => b.g === 'dan') ?? [];
        if (danId) await orphanBoard(danId);
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

    /**
     * The defect the audit called presently fatal, asserted where it failed.
     *
     * The app derived a remark's voice from the BOARD it was written on; the
     * rules derived it from the token. Those agreed only where a board's author
     * equalled the writer's uid — which the shipped seed guaranteed never
     * happened, since every personal board arrives with an author nobody holds.
     * So an expert could not write one strength, weakness or note on any
     * personal board. And because a refused write was merged back into every
     * read, his note stayed on screen, across reloads, while the database never
     * held it: the failure this project keeps hitting, in its purest form.
     *
     * Both halves are fixed — `myVoice()` sends the writer, `ownsVoice()`
     * compares against the token — and this asserts against Firestore, because
     * the screen was never the part that was wrong.
     */
    test('an expert writes a remark on a board he does not own, and it reaches Firestore', async ({ page }) => {
        const boards = await collection('boards');
        const [danId, dan] = Object.entries(boards).find(([, b]) => b.g === 'dan') ?? [];
        expect(danId, 'the emulator needs seeding — see the header of playwright.shared.config.js').toBeTruthy();

        // Deliberately somebody ELSE's board: its author is the seeded analyst,
        // never this uid. That is the only interesting case — a board whose
        // author happened to equal the writer was the one that always worked.
        expect(dan.a, "dan's board should have an author").toBeTruthy();

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 60_000 });
        await page.getByRole('button', { name: /Scouting/i }).click();
        await expect(page.locator('.switcher-btn', { hasText: 'Consensus' })).toBeVisible({ timeout: 30_000 });

        const who = await signInAsExpert(page, 'remarks@example.com');
        expect(who.uid).toBeTruthy();
        expect(dan.a).not.toBe(who.uid);

        // A reload rather than waiting on the auth listener, for the same reason
        // as the claim test: the session is in IndexedDB, and coming up with it
        // already signed in is the path a real expert takes.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 60_000 });
        await page.getByRole('button', { name: /Scouting/i }).click();

        const danTab = page.locator('.switcher-btn', { hasText: 'Dan' });
        await expect(danTab).toBeVisible({ timeout: 30_000 });
        await danTab.click();

        const card = page.locator('.player-card').first();
        await expect(card).toBeVisible({ timeout: 30_000 });
        await card.click();

        // Cleared first. The uid is derived from the email, so a document from
        // an earlier run sits at precisely the path this asserts on.
        for (const stale of (await collectionGroup('remarks')).filter(r => r.id === who.uid)) {
            await remove(stale.path);
        }

        const text = `reached the database ${who.uid.slice(0, 6)}`;
        const field = page.getByPlaceholder(/Add strength/i);
        await expect(field).toBeVisible({ timeout: 15_000 });
        await field.fill(text);
        await field.press('Enter');

        // Polled on the TEXT, not on a count. A count was unsound: a document
        // keyed by this uid can exist for other reasons — one did, and the
        // assertion passed on words the app had written in an earlier run. The
        // only thing that proves THIS write arrived is this write's own words.
        //
        // Keyed by the WRITER, under whichever player was clicked, which is why
        // this asks the collection group rather than a path it would have to
        // guess. A remark filed under a uid is a remark attributed to a person;
        // one filed under a board id is the bug.
        const mine = async () => (await collectionGroup('remarks'))
            .filter(r => r.id === who.uid && JSON.stringify(r.fields).includes(text));
        await expect.poll(async () => (await mine()).length, {
            timeout: 25_000,
            message: 'the remark the app just wrote did not reach Firestore',
        }).toBe(1);

        const [landed] = await mine();
        expect(landed.path).toMatch(new RegExp(`^evaluations/.+/remarks/${who.uid}$`));

        // And nothing was filed under the board, which is what used to be
        // attempted, refused, and then shown as saved anyway.
        const underBoard = (await collectionGroup('remarks')).filter(r => r.id === danId);
        expect(underBoard, 'a board is not a voice and must own no remarks').toHaveLength(0);
    });

    /**
     * Signing in is enough. Nobody reloads a page mid-broadcast.
     *
     * Both tests above sign in and then reload, and the reload is doing real
     * work: the app boots its React tree outside the auth chain, so the first
     * reads happen before the session is known. If nothing re-reads when the
     * session arrives, an expert who signs in is still looking at a viewer's
     * app — his own board missing from the switcher — until he thinks to
     * refresh.
     */
    test('an expert who signs in sees his board without reloading', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.view-tabbar', { timeout: 60_000 });
        await page.getByRole('button', { name: /Scouting/i }).click();
        await expect(page.locator('.switcher-btn', { hasText: 'Consensus' })).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.switcher-btn', { hasText: 'Dan' })).toHaveCount(0);

        await signInAsExpert(page, 'noreload@example.com');

        // No reload. The app has to notice on its own.
        await expect(page.locator('.switcher-btn', { hasText: 'Dan' }))
            .toBeVisible({ timeout: 30_000 });
    });
});
