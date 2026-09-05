import { useEffect, useMemo, useState } from 'react';
import { parseRankings } from '../utils/dataParser';
import * as scoutingState from '../utils/scoutingState';
import { applyProspects } from '../utils/prospects';
import { identityKey, nameKey } from '../utils/nameMatcher';
import { resolveAll, openRegistry } from '../utils/playerRegistry';
import { migrateLegacyScores } from '../utils/athleticMatrix';

const { BOARDS, BOARD_RANKINGS } = scoutingState;

/**
 * Loads every analyst's rankings file once, so Scouting can show each board's
 * real player pool rather than laying all three overlays over whichever single
 * file the draft view happened to load.
 *
 * They are different boards, not different opinions about one list — different
 * players, tiers and order — so the pool has to switch with the board.
 *
 * Returns `{ pools, loading }` where `pools` is `{ consensus: [...], ... }`.
 * A board whose file is missing or unreadable falls back to `fallback` (the
 * already-loaded draft pool) so the view still works instead of going blank.
 */
// The rankings files are static, so they're fetched and parsed once per page
// load and shared by every caller. Without this, each mount of Scouting or of
// an info card refetched and reparsed all three — which is both wasteful and
// slow enough to have pushed a test over its timeout.
// Only the FETCHED files are cached. Prospects are merged in on every call,
// so adding one is a re-merge rather than three more network round-trips.
let filesPromise = null;

function loadFiles() {
    if (filesPromise) return filesPromise;
    const base = import.meta.env.BASE_URL;

    filesPromise = Promise.all(BOARDS.map(async (board) => {
        try {
            const res = await fetch(`${base}${BOARD_RANKINGS[board]}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const players = parseRankings(await res.text()) || [];
            return [board, players.filter(p => p?.name)];
        } catch {
            // Cached as null so a missing file falls back per caller rather
            // than being retried on every mount.
            return [board, null];
        }
    })).then(Object.fromEntries);

    return filesPromise;
}

/**
 * How a player is matched ACROSS analyst files, which is not the same question
 * as whether two players are the same person.
 *
 * Position tells two people apart when someone is entering players — that is
 * what stops two men called Chris Jones being merged. But across rankings
 * files it is not evidence of anything: analysts label the same man DL and
 * EDGE all the time, and joining on position turned one player into two, with
 * duplicate React keys that leaked rows on every board switch.
 *
 * So the join is by name, EXCEPT for a name that appears more than once inside
 * a single file — there the analyst has deliberately listed two people, and
 * position is doing real work.
 */
function joinKeyFor(files) {
    const ambiguous = new Set();
    BOARDS.forEach(board => {
        const seenInFile = new Set();
        (files[board] ?? []).forEach(p => {
            const n = nameKey(p.name);
            if (seenInFile.has(n)) ambiguous.add(n);
            seenInFile.add(n);
        });
    });
    return (p) => (ambiguous.has(nameKey(p.name)) ? identityKey(p.name, p.position) : nameKey(p.name));
}

/**
 * Every player any board knows about, in consensus order first so the biggest
 * file sets the baseline ordering and the others contribute their extras.
 */
function unionOfFiles(files, keyOf) {
    const seen = new Map();
    BOARDS.forEach(board => {
        (files[board] ?? []).forEach(p => {
            const key = keyOf(p);
            if (!seen.has(key)) seen.set(key, p);
        });
    });
    return [...seen.values()];
}

function loadPools() {
    return Promise.all([loadFiles(), openRegistry()]).then(([files]) => {
        // Base data edited in-app — players added, corrected, or removed — is
        // shared by every board, so it is applied before anything ranks,
        // places, tags or exports. From here down there is no such thing as an
        // "app-added" player: they are all just players.
        const keyOf = joinKeyFor(files);
        const union = applyProspects(unionOfFiles(files, keyOf));

        // The one place a name becomes an identity. Every player carries a
        // stable id from here on, so nothing downstream has to re-derive who
        // he is from his name (see utils/playerRegistry.js). Resolved in one
        // batch: the name index is built once for the whole pool rather than
        // once per player.
        const ids = resolveAll(union);
        const everyone = union.map((p, i) => (ids[i] ? { ...p, id: ids[i] } : p));

        // Matrix scores used to have a store of their own. Now that every
        // player has a record to hang facts on, they move onto it — here,
        // because this is the first moment the records exist to move them to.
        migrateLegacyScores();

        // A player one analyst has ranked and another hasn't is not missing
        // from the second board — he is UNRANKED on it. Dropping him meant a
        // player Ryan rated highly simply did not exist on Dan's board, so
        // there was nowhere to disagree. Every board carries every player;
        // what differs is where each one has been placed.
        const pools = Object.fromEntries(BOARDS.map(board => {
            const file = files[board];
            if (!file?.length) return [board, file];

            const own = new Map(file.map(p => [keyOf(p), p]));
            return [board, everyone.map(p => {
                // A corrected player is looked up by the identity his file
                // gives him, not the corrected one, or his own board would
                // stop recognising him the moment his name was fixed.
                const origin = p.sourceIdentity ?? p;
                const mine = own.get(keyOf(origin));
                return mine
                    ? { ...p, round: mine.round, tier: mine.tier, overallRank: mine.overallRank, isFavorite: mine.isFavorite }
                    : { ...p, round: null, tier: null, overallRank: null, isFavorite: false };
            })];
        }));

        // A `*` in a rankings file becomes a real `like` tag on that board, so
        // the star and the tag are one mechanic rather than two that can
        // disagree. Only adds entries for players that don't have one, so it
        // can never overwrite an analyst's own tag.
        BOARDS.forEach(board => {
            if (!pools[board]?.length) return;
            // The file creates the initial state and then steps out of the
            // way: after this the board lives in storage and is read from
            // there. Favourites are seeded as part of it.
            scoutingState.seedBoard(board, pools[board]);
            // Entries written before the registry existed are joined to their
            // player once, here, rather than by name on every read.
            scoutingState.attachPlayerIds(board, pools[board]);
            scoutingState.seedFavourites(board, pools[board]);
        });
        return pools;
    });
}

// Adding a prospect has to reach boards that are already on screen, so the
// hook subscribes rather than only reading at mount.
let generation = 0;
const listeners = new Set();

/** Re-merges the prospect list into every mounted board's pool. */
export function invalidatePools() {
    generation += 1;
    listeners.forEach(fn => fn());
}

export default function useBoardRankings(fallback) {
    const [pools, setPools] = useState(null);
    const [gen, setGen] = useState(generation);

    useEffect(() => {
        const bump = () => setGen(generation);
        listeners.add(bump);
        return () => { listeners.delete(bump); };
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadPools().then(loaded => { if (!cancelled) setPools(loaded); });
        return () => { cancelled = true; };
    }, [gen]);

    // Memoised so the returned object is stable between renders. Callers use
    // it as an effect dependency — "the pools have arrived" is the signal that
    // the boards have been seeded and are worth re-reading — and a fresh
    // object every render would make that fire forever.
    const resolved = useMemo(
        () => (pools ? Object.fromEntries(BOARDS.map(b => [b, pools[b]?.length ? pools[b] : fallback])) : null),
        [pools, fallback],
    );

    if (!resolved) return { pools: null, loading: true };
    return { pools: resolved, loading: false };
}
