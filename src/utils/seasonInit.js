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
import { readStage, writeStage } from '../data/stageStore';
import { STATE_VERSION as ROSTER_VERSION } from './rosterState';

const DONE_KEY = 'season_init_v1';

const read = () => {
    try { return JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch { return []; }
};

/** Whether this season's stages have been set up. */
export function isInitialised(seasonId) {
    return !!seasonId && read().includes(seasonId);
}

export function markInitialised(seasonId) {
    if (!seasonId || isInitialised(seasonId)) return;
    try { localStorage.setItem(DONE_KEY, JSON.stringify([...read(), seasonId])); } catch { /* ignore */ }
}

/** Forgets one season, so scrapping it does not leave its id behind forever. */
export function forgetSeason(seasonId) {
    try { localStorage.setItem(DONE_KEY, JSON.stringify(read().filter(id => id !== seasonId))); } catch { /* ignore */ }
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

    const put = (base, value) => writeStage(base, seasonId, value);

    const last = carryRosterFrom ? readStage('rosterState', carryRosterFrom) : null;

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

    put('nfl_draft_board_state', EMPTY_DRAFT());
    // The prospect pool is left ABSENT rather than written empty: it seeds
    // itself on first use, gated on whether this is the shipped season, and an
    // empty written state is indistinguishable from one somebody cleared.
    markInitialised(seasonId);
    return true;
}
