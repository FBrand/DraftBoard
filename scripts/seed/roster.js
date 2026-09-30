/**
 * The 53-man roster the shipped data starts from.
 *
 * `fetchLocalRoster()` and `fetchSeasonStartStructure()` were in the app: one
 * read the hand-edited `roster.csv`, the other last season's holdovers to get the
 * position rows without the players. Both fetched a file the build no longer
 * carries, which is the point — an app that reads a shipped roster is an app
 * deciding who is on the team from a text file it happens to ship.
 *
 * `roster.csv` is the one hand-edited roster in the repo, and it records how every
 * player arrived in the suffix on his name. See scripts/build-roster-snapshots.mjs,
 * which derives the two earlier states from it.
 */
import { parseCSV } from '../../src/utils/rosterState.js';

/** The roster the day before cutdown: 91 players, as hand-edited. */
export async function readShippedRoster() {
    const res = await fetch('roster.csv');
    if (!res.ok) throw new Error(`Could not read roster.csv (HTTP ${res.status})`);
    return parseCSV(await res.text());
}

/**
 * Last season's shape with nobody in it — the position rows and nothing else.
 *
 * A roster built from `defaultState()` has no position rows at all, so
 * "Sync from FA/Draft/UDFA" resolves each player to a row, finds none, and
 * silently places nobody. Starting from the real shape means the pipeline has
 * somewhere to land.
 */
export async function readSeasonStartStructure() {
    const res = await fetch('roster_2025_end.csv');
    if (!res.ok) throw new Error(`Could not read roster_2025_end.csv (HTTP ${res.status})`);
    const parsed = parseCSV(await res.text());
    const depthChart = {};
    Object.keys(parsed.depthChart).forEach(id => { depthChart[id] = []; });
    return { ...parsed, depthChart, reserve: [], cuts: [] };
}
