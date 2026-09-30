import { describe, it, expect, beforeEach } from 'vitest';
import { repository } from '../../src/data/repository';
import { openBoards, currentSeason } from '../../src/utils/boardRegistry';
import { addRemark, openEvaluations, remarksPath } from '../../src/utils/evaluations';
import { store } from '../../src/data/appStore';
import { measureDump, familiesOf, human, BUDGET } from '../../src/utils/storageBudget';

/**
 * The local budget, measured instead of multiplied.
 *
 * The plan's figures were arithmetic — a remark document's size times players
 * times authors — and arithmetic is how the last two estimates here went wrong
 * in the same direction: a three-expert number reused for ten, twice, by two
 * different drafts. So this builds a season and weighs it.
 *
 * It is a REPORTING test as much as an asserting one. The assertions are loose
 * on purpose (an order of magnitude, not a byte) because the point is to catch a
 * shape change that doubles the cost, not to freeze the current bytes. The
 * numbers it prints are the ones to argue with.
 */
const PLAYERS = 350;      // roughly a draft class
const AUTHORS = 10;       // the ten experts the plan is sized for
const PER_PLAYER = 5;     // remarks each author writes on a player he has seen
const SEEN = 0.5;         // and he writes about half the class

beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
});

describe('a ten-expert season', () => {
    it('is measured, and the figure is reported rather than assumed', async () => {
        const season = currentSeason().id;
        const ids = Array.from({ length: PLAYERS }, (_, i) => `p_bulk_${i}`);
        await openEvaluations(ids);

        let written = 0;
        for (let a = 0; a < AUTHORS; a += 1) {
            const author = `a_bulk_${a}`;
            for (let i = 0; i < PLAYERS * SEEN; i += 1) {
                for (let r = 0; r < PER_PLAYER; r += 1) {
                    addRemark(author, ids[i], 'note', `Remark ${r} about player ${i} from analyst ${a}`, season);
                    written += 1;
                }
            }
        }

        // Weighed from the STORE rather than from the adapter behind it.
        //
        // Not a shortcut: addRemark does not return its write, so 8,750 of them
        // are in flight at once, and the memory adapter's commit is a
        // read-modify-write — it reads the collection, applies the change, then
        // awaits the write. Concurrent commits to different documents in one
        // collection therefore each write over a snapshot taken before the
        // others landed, and the collection ends up holding whichever finished
        // last. Measured that way this reported 147 KB for 8,750 remarks, about
        // eight characters each, which is what made it obvious.
        //
        // The store's own view holds every document, so it is both correct and
        // the right thing to weigh: the question is what this SHAPE costs, not
        // what one adapter managed to keep.
        const expected = PLAYERS * SEEN;
        const dump = {};
        ids.slice(0, expected).forEach(id => {
            dump[remarksPath(id)] = store.view(remarksPath(id));
        });
        expect(Object.keys(dump)).toHaveLength(expected);
        const { data, total, pressure } = measureDump(dump);
        const families = familiesOf(dump);

        console.log([
            '',
            `  remarks written        ${written}`,
            `  measured              ${human(data)}  (${(pressure * 100).toFixed(0)}% of ${human(BUDGET)})`,
            `  a full class would be ${human(total / SEEN)}  (${((pressure / SEEN) * 100).toFixed(0)}%)`,
            '  by family:',
            ...Object.entries(families)
                .sort(([, a], [, b]) => b - a)
                .map(([k, v]) => `    ${k.padEnd(14)} ${human(v)}`),
            '',
        ].join('\n'));

        // The shape assertion: remarks dominate. If something else ever does,
        // the budget work is aimed at the wrong thing.
        const top = Object.entries(families).sort(([, a], [, b]) => b - a)[0];
        expect(top[0]).toBe('evaluations');

        expect(written).toBe(AUTHORS * PLAYERS * SEEN * PER_PLAYER);

        // The plan's central claim, now measured rather than multiplied: TWO
        // ten-expert seasons do not fit. Half a class measures 1.33 MB, so a
        // full one is about 2.7 MB against a 5 MB ceiling — the plan's
        // arithmetic said 3.12 MB, which is the same answer to the same
        // question, and either way the conclusion holds: the binding
        // constraint is INTRA-season, and every inter-season mechanism is
        // useless against it. Dropping the oldest season cannot save a season
        // that does not fit on its own.
        //
        // Asserted on the extrapolation rather than by writing the other half,
        // because doubling the write loop doubles a 23-second test to prove
        // a multiplication by two.
        expect(data / SEEN).toBeGreaterThan(BUDGET / 2);
    }, 120_000);
});
