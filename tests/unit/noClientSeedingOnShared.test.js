import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openBoards, allBoards } from '../../src/utils/boardRegistry';
import { seedExampleEvaluations } from '../../scripts/seed/exampleEvaluations';
import { repository } from '../../src/data/repository';
import { readFileSync } from 'node:fs';

/**
 * A browser does not seed a shared database.
 *
 * It tried, for weeks, and could not have succeeded: `authors` may only be
 * created keyed by the caller's own uid, so the placeholder records for Dan and
 * Ryan are refused by construction, and `email2author` refuses
 * `invitedBy: 'seed'` because an invite names a real inviter. What actually
 * happened depended on who was looking. A viewer had everything refused and
 * kept a private season in his overlay that looked exactly like a seeded app.
 * An expert got the season and the boards through and the authors and invites
 * refused, leaving boards pointing at authors that do not exist — which is the
 * state the shared project was found in.
 *
 * Seeding belongs outside now (scripts/seed-firestore.mjs), once, before
 * anybody signs in. These assert the client stays out of it, because the
 * refusals were invisible from the screen and nothing else would notice.
 */
describe('client-side seeding on a shared backend', () => {
    beforeEach(() => {
        globalThis.resetStorage();
        repository.invalidate();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('writes no boards, no authors and no invites', async () => {
        vi.spyOn(repository, 'isLive').mockReturnValue(true);
        await openBoards();

        expect(allBoards()).toHaveLength(0);
        expect(repository.docs('authors') ?? {}).toEqual({});
        expect(repository.docs('email2author') ?? {}).toEqual({});
        expect(repository.docs('seasons') ?? {}).toEqual({});
    });

    it('writes no example remarks either', async () => {
        // Two things have to be true before a 0 here means anything, and
        // neither was: with no board for Dan there is no voice to file the
        // example under, and in node the fetch for the CSV fails. Either one
        // returns 0 on its own, so the first version of this test passed with
        // the gate deliberately removed. Arrange both, THEN go shared.
        // Asserted on the FETCH, not on the return value. Three separate things
        // make this function return 0 — no board for Dan, a failed fetch, and
        // an empty player registry — and in a node test the last two are true
        // anyway, so a returned 0 proved nothing: the first two versions of
        // this test passed with the gate deliberately removed. Whether it goes
        // and reads its file is something only the gate decides.
        const csv = readFileSync('public/evaluations_kc_2026.csv', 'utf8');
        const fetched = vi.fn(async () => ({ ok: true, async text() { return csv; } }));
        vi.stubGlobal('fetch', fetched);
        await openBoards();
        expect(allBoards().length).toBeGreaterThan(0);

        vi.spyOn(repository, 'isLive').mockReturnValue(true);
        expect(await seedExampleEvaluations()).toBe(0);
        expect(fetched, 'it went looking for the example file').not.toHaveBeenCalled();
        expect(repository.collections().filter(c => c.includes('remarks'))).toEqual([]);
    });

    // The other half of the same rule: a local-only app has no outside seeder,
    // so it must still come up with its boards. A gate that stopped both would
    // pass the test above and leave the local app blank.
    it('still seeds a local backend, which has no seeder of its own', async () => {
        await openBoards();
        expect(allBoards().length).toBeGreaterThan(0);
    });
});
