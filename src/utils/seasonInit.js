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
 *   - A season started in the app begins empty, except for the roster, which
 *     carries forward because a team does not stop existing in February.
 *
 * Recorded rather than inferred: "the draft is empty" and "the draft has not
 * been set up yet" look identical in storage, and treating the first as the
 * second is what re-seeded a season somebody had deliberately cleared.
 */
import { seasonScopedKey } from './appStorage';
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

const EMPTY_ROSTER = JSON.stringify({
    version: ROSTER_VERSION,
    positionConfig: { offense: [], defense: [] },
    depthChart: {},
    reserve: [],
    cuts: [],
});

const EMPTY_DRAFT = JSON.stringify({ draftedPlayers: [], ourPicksLeft: [] });

/**
 * Sets a season up, if it has not been. Safe to call on every load.
 *
 * `carryRosterFrom` is the season being left behind on a rollover; its roster
 * is copied, not shared, so editing this year's does not rewrite last year's
 * record.
 */
export function initialiseSeason(seasonId, { carryRosterFrom = null } = {}) {
    if (!seasonId || isInitialised(seasonId)) return false;

    const put = (base, value) => {
        try { localStorage.setItem(seasonScopedKey(base, seasonId), value); } catch { /* ignore */ }
    };

    let roster = EMPTY_ROSTER;
    if (carryRosterFrom) {
        try {
            const carried = localStorage.getItem(seasonScopedKey('rosterState', carryRosterFrom));
            if (carried != null) roster = carried;
        } catch { /* keep the empty one */ }
    }

    put('rosterState', roster);
    put('nfl_draft_board_state', EMPTY_DRAFT);
    // Free agency and the prospect pool are left ABSENT rather than written
    // empty: both seed themselves from a file on first use, and that seeding is
    // gated on whether this is the shipped season. An empty written state would
    // be indistinguishable from one somebody cleared.
    markInitialised(seasonId);
    return true;
}
