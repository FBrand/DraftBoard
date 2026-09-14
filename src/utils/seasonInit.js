/**
 * What a season starts with, decided once.
 *
 * Every stage used to answer this for itself — "is there a saved state, and is
 * the app in seeded mode, and does a shipped file exist" — with the answer
 * spread across four stores and a hook. It held together while there was one
 * season, and came apart the moment there were two: rolling over to a new
 * season left last year's roster in place, re-read last year's picks out of
 * `DraftBoard_Picks.csv`, and fell back to the shipped rankings file for a
 * class that had not been drafted yet. The new season was the old one wearing
 * a different number.
 *
 * So it is one question now, asked once per season and recorded:
 *
 *   - The season the app SHIPPED with reads the files in `public/`. They
 *     describe exactly that year — its class, its picks, the roster they
 *     produced — and they are not about any other.
 *   - A season started in the app begins where an offseason begins. Free
 *     agency holds last season's roster, because those are the players whose
 *     futures are the question. The new roster keeps that roster's SHAPE — its
 *     position rows and slot counts — and none of its players, because the
 *     53 is what the offseason produces, not what it starts from. That is the
 *     same split the shipped files make: roster_2025_end.csv gives the
 *     structure, roster_predraft.csv gives free agency its candidates.
 *
 * Recorded rather than inferred: "the draft is empty" and "the draft has not
 * been set up yet" look identical in storage, and treating the first as the
 * second is what re-seeded a season somebody had deliberately cleared.
 */
import { readStage } from '../data/stageStore';
import { hasChart, readChart, writeChart } from '../data/depthChartStore';
import { writeDraft } from '../data/draftStore';
import { STATE_VERSION as ROSTER_VERSION } from './rosterState';
import { repository } from '../data/repository';

/**
 * The marker lives in the TARGET store, not in this browser.
 *
 * It was a localStorage key, which is the right answer for exactly one
 * backend. Point the app at a shared one and every visitor arrives with an
 * empty local marker, decides the season has never been set up, and seeds it
 * again over the top of everybody's work. The first client to run should seed,
 * and no client after it should repeat.
 *
 * So it is a document beside the data it describes. Whoever gets there first
 * writes it; everybody else reads it and does nothing.
 */
/** The pre-path collection. Read once for migration; never written. */
export const SETUP = 'setup';

/**
 * The markers live under the season they are about.
 *
 *     seasons/{seasonId}/setup/season
 *     seasons/{seasonId}/setup/facts
 *
 * They were `setup/season__{id}` and `setup/facts__{id}` in one shared
 * collection. Nothing ever scanned it — both reads are exact — so the
 * composite key was ugly rather than wrong. What it cost is that a season was
 * not deletable as a subtree: every other thing a season owns is under it now,
 * and two markers in a collection of their own were the last exception.
 */
export const setupPath = (seasonId) => `seasons/${seasonId ?? '_'}/setup`;

const MARKER = 'season';
const legacyMarkerId = (seasonId) => `season__${seasonId}`;

/** Whether this season's stages have been set up — by anyone, anywhere. */
export function isInitialised(seasonId) {
    if (!seasonId) return false;
    return !!repository.get(setupPath(seasonId), MARKER)
        || !!repository.get(SETUP, legacyMarkerId(seasonId));
}

export function markInitialised(seasonId) {
    if (!seasonId || isInitialised(seasonId)) return;
    // The body is when. The season and what this marks are the address.
    repository.set(setupPath(seasonId), MARKER, { at: Date.now() });
}

/** Loads the legacy markers, so a season set up by an older build is known. */
export function openSetup() {
    return repository.ready(SETUP);
}

/** Forgets one season, so scrapping it does not leave its id behind forever. */
export function forgetSeason(seasonId) {
    // Both addresses: a season scrapped before it was ever read may still be
    // marked at the old one.
    repository.remove(SETUP, legacyMarkerId(seasonId));
    repository.remove(SETUP, `facts__${seasonId}`);
    // The shipped facts were laid over this season once; a season that no
    // longer exists has not been seeded. See playerFacts.factsSeeded.
    repository.remove(setupPath(seasonId), MARKER);
    repository.remove(setupPath(seasonId), 'facts');
}

/**
 * Last season's roster, from wherever it actually lives.
 *
 * This read used to be `readStage('rosterState', …)` alone, and it had
 * silently stopped finding anything: the roster moved to row documents
 * (depthChartStore) so one drag writes one row, and the stage blob became the
 * legacy shape that `rosterState.loadState` reads once and migrates forward.
 *
 * Nothing failed loudly. `last` came back null, so a rollover wrote an empty
 * roster and no free agency at all — and because an empty `positionConfig`
 * does not satisfy the roster's own fallback, the new season fell through to
 * bootstrapping `roster.csv` and arrived with all 91 players from a season it
 * had nothing to do with. "New season — roster is prefilled, FA is empty" was
 * one missing store, twice.
 *
 * Same precedence the roster itself uses, so the two cannot drift apart again.
 */
function readRoster(seasonId) {
    if (hasChart('rosterState', seasonId)) return readChart('rosterState', seasonId);
    const parsed = readStage('rosterState', seasonId);
    return parsed?.positionConfig?.offense?.length > 0 ? parsed : null;
}

const EMPTY_ROSTER = () => ({
    version: ROSTER_VERSION,
    positionConfig: { offense: [], defense: [] },
    depthChart: {},
    reserve: [],
    cuts: [],
});

const EMPTY_DRAFT = () => ({ draftedPlayers: [], ourPicksLeft: [] });

/** The same depth chart with nobody standing in it. */
function emptied(state) {
    const depthChart = {};
    Object.keys(state.depthChart ?? {}).forEach(id => { depthChart[id] = []; });
    return { ...state, depthChart, reserve: [], cuts: [] };
}

/**
 * Sets a season up, if it has not been. Safe to call on every load.
 *
 * `carryRosterFrom` is the season being left behind on a rollover. Its roster
 * is read once and used twice — as free agency's candidates, and, emptied of
 * players, as this season's depth chart. Copied rather than shared, so nothing
 * done this year rewrites last year's record.
 */
export function initialiseSeason(seasonId, { carryRosterFrom = null } = {}) {
    if (!seasonId || isInitialised(seasonId)) return false;

    const put = (base, value) => writeChart(base, seasonId, value);

    const last = carryRosterFrom ? readRoster(carryRosterFrom) : null;

    if (last) {
        // Free agency is where an offseason starts, and it starts with the
        // players whose futures are the question: last season's roster.
        put('fa_state_v1', last);
        // The 53 is what the offseason PRODUCES. It keeps the shape — the
        // position rows and how many each holds — and none of the players.
        put('rosterState', emptied(last));
    } else {
        put('rosterState', EMPTY_ROSTER());
    }

    writeDraft(seasonId, EMPTY_DRAFT());
    // The prospect pool is left ABSENT rather than written empty: it seeds
    // itself on first use, gated on whether this is the shipped season, and an
    // empty written state is indistinguishable from one somebody cleared.
    markInitialised(seasonId);
    return true;
}
