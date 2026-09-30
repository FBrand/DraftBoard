import { describe, it, expect, beforeEach } from 'vitest';
import { evictionPlan, measure, BUDGET } from '../../src/utils/storageBudget';

/**
 * A local build does not lose data to make room.
 *
 * The two builds hold the same shapes and mean different things by them. On a
 * shared backend the local copy is a CACHE — every remark, entry and chart can
 * be fetched again, so discarding one costs a round trip. On a local build the
 * local copy IS the data, and discarding a remark loses it for good.
 *
 * Which build is running is not what decides it, and that distinction is the
 * whole reason this function exists rather than a flag: `SPEC.md` §7 has a
 * session exported and restored as a file, so a local build can be holding a
 * ten-author season it did not write — exactly the volume it is said never to
 * reach. So the caller says whether the data can be fetched again, and this
 * refuses to call anything evictable when it cannot.
 */
const fill = (bytes) => {
    // One big value, which is all measure() cares about. Half the characters,
    // because a UTF-16 code unit is two bytes and that is what a browser bills.
    globalThis.localStorage.setItem('db_evaluations/p_1/remarks', 'x'.repeat(bytes / 2));
};

beforeEach(() => {
    globalThis.resetStorage();
});

describe('making room', () => {
    it('is not needed while there is room', () => {
        fill(BUDGET * 0.1);
        const plan = evictionPlan({ canRefetch: false });

        expect(plan.needed).toBe(false);
        expect(plan.safe).toBe(true);
    });

    it('refuses on a local build, and says what it would take', () => {
        fill(BUDGET * 0.9);
        const plan = evictionPlan({ canRefetch: false });

        expect(plan.needed).toBe(true);
        expect(plan.safe).toBe(false);
        // Not a bare refusal: somebody whose roster has stopped saving needs to
        // know why and what to do, or the message is one to click through.
        expect(plan.reason).toMatch(/only copy/i);
        expect(plan.reason).toMatch(/export/i);
    });

    it('says when the last export was, where there has been one', () => {
        fill(BUDGET * 0.9);
        const plan = evictionPlan({ canRefetch: false, exportedAt: '2026-09-30' });

        expect(plan.safe).toBe(false);
        expect(plan.reason).toContain('2026-09-30');
    });

    it('allows it on a shared build, largest family first', () => {
        globalThis.localStorage.setItem('db_boards/b_1/entries', 'x'.repeat(BUDGET * 0.1));
        fill(BUDGET * 0.8);

        const plan = evictionPlan({ canRefetch: true });

        expect(plan.needed).toBe(true);
        expect(plan.safe).toBe(true);
        expect(plan.drop[0].family).toBe('evaluations');
        expect(plan.frees).toBeGreaterThan(0);
    });

    it('measures the keys as well as the values', () => {
        // 700 player documents at one key each is not free, and every key here
        // carries a path. A measurement that ignored them would report a budget
        // with room in it that a browser does not agree exists.
        globalThis.localStorage.setItem('db_a_very_long_collection_path/with/segments', '');
        const { total } = measure();
        expect(total).toBeGreaterThan(0);
    });
});

/**
 * A quota error is better evidence than a measurement.
 *
 * `measure()` sees only this app's keys. The quota is shared with everything
 * else on the origin and the limit varies by browser, so a store the browser has
 * just refused to write can measure comfortably under budget. Wired to a real
 * quota failure, this answered **"There is room."** — to somebody whose roster
 * had stopped saving.
 */
describe('a caller holding a quota error', () => {
    it('is not told there is room', () => {
        // Nothing stored at all: the measurement could not look better.
        const plan = evictionPlan({ canRefetch: false, assumeFull: true });

        expect(plan.needed).toBe(true);
        expect(plan.reason).not.toMatch(/there is room/i);
        expect(plan.reason).toMatch(/only copy/i);
    });

    it('is still told what can go, when something can', () => {
        globalThis.localStorage.setItem('db_evaluations/p_1/remarks', 'x'.repeat(2048));
        const plan = evictionPlan({ canRefetch: true, assumeFull: true });

        expect(plan.safe).toBe(true);
        expect(plan.drop[0].family).toBe('evaluations');
    });
});
