/**
 * The free-agency candidate board the shipped data starts from.
 *
 * This was `faState.ensureSeeded()`, in the app, and most of it was guard rather
 * than seeding: wait for the seasons to arrive or the chart is filed under a
 * season that exists nowhere; wait for the chart to be asked for or "nothing is
 * saved here" answers about the cache instead of the store. Both were real bugs
 * and both existed only because the app was seeding at all.
 *
 * The seeder starts from an empty store it built itself, so neither guard has
 * anything to protect against, and what is left is the seeding: the pre-draft
 * roster becomes the candidate board. Free agency is *done* by the day before the
 * draft, which is why that file is the one it starts from.
 */
import { fetchSeasonStartRoster, saveState } from '../../src/utils/faState.js';
import { openDepthCharts } from '../../src/data/depthChartStore.js';
import { viewedSeason } from '../../src/utils/boardRegistry.js';

export async function seedFreeAgency() {
    // The chart collections have to be OPEN before writeChart decides whether a
    // band is a change: an unloaded collection makes an empty reserve look like
    // nothing rather than like an empty reserve, and the document is skipped.
    await openDepthCharts(viewedSeason()?.id ?? null);
    const seeded = await fetchSeasonStartRoster();
    saveState(seeded);
    return seeded;
}
