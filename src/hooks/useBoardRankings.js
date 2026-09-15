import { useEffect, useMemo, useState } from 'react';
import { openStages } from '../data/stageStore';
import { openBoardEntries } from '../data/boardEntries';
import { openDepthCharts } from '../data/depthChartStore';
import { openSetup } from '../utils/seasonInit';
import { parseRankings } from '../utils/dataParser';
import * as scoutingState from '../utils/scoutingState';
import { applyProspects } from '../utils/prospects';
import { identityKey, nameKey } from '../utils/nameMatcher';
import { resolveAll, openRegistry, byId } from '../utils/playerRegistry';


import { openBoards, listBoards } from '../utils/boardRegistry';
import { openEvaluations } from '../utils/evaluations';
import { applyPlayerFacts } from '../utils/playerFacts';
import { seedExampleEvaluations } from '../utils/exampleEvaluations';

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

    filesPromise = Promise.all(listBoards().map(async (board) => {
        try {
            if (!board.rankingsFile) return [board.id, null];
            const res = await fetch(`${base}${board.rankingsFile}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const players = parseRankings(await res.text()) || [];
            return [board.id, players.filter(p => p?.name)];
        } catch {
            // Cached as null so a missing file falls back per caller rather
            // than being retried on every mount.
            return [board.id, null];
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
    Object.values(files).forEach(file => {
        const seenInFile = new Set();
        (file ?? []).forEach(p => {
            const n = nameKey(p.name);
            if (seenInFile.has(n)) ambiguous.add(n);
            seenInFile.add(n);
        });
    });
    return (p) => (ambiguous.has(nameKey(p.name)) ? identityKey(p.name, p.position) : nameKey(p.name));
}

/**
 * Players a file rates twice — the same man, at the same position, on two
 * rows.
 *
 * Not the same thing as the ambiguity above. A name appearing twice at two
 * POSITIONS is an analyst deliberately listing two people, and the app handles
 * it by making position part of the key. A name appearing twice at ONE
 * position is a file contradicting itself: rankings_dan.csv had Jakobe Thomas
 * at 3.4 and again at 5.3.
 *
 * That was resolved silently, by line order, and the two rules involved
 * disagreed — the shared pool kept the first row, the board's own placement
 * kept the last. Nobody was told either way, and the board rendered as though
 * the file said one thing.
 */
export function duplicatesIn(files) {
    const out = [];
    Object.entries(files ?? {}).forEach(([boardId, file]) => {
        const counts = new Map();
        (file ?? []).forEach(p => {
            const key = identityKey(p.name, p.position);
            const seen = counts.get(key);
            if (seen) seen.rows.push(p);
            else counts.set(key, { name: p.name, position: p.position, rows: [p] });
        });
        counts.forEach(v => {
            if (v.rows.length > 1) {
                out.push({
                    boardId,
                    name: v.name,
                    position: v.position,
                    count: v.rows.length,
                    // What the rows actually disagree about, which is the part
                    // worth showing: "3.4 and 5.3" says more than "twice".
                    placements: v.rows.map(r => (r.round == null ? 'unranked' : `${r.round}.${r.tier ?? 1}`)),
                });
            }
        });
    });
    return out;
}

/**
 * Every player any board knows about, in consensus order first so the biggest
 * file sets the baseline ordering and the others contribute their extras.
 */
function unionOfFiles(files, keyOf) {
    const seen = new Map();
    Object.values(files).forEach(file => {
        (file ?? []).forEach(p => {
            const key = keyOf(p);
            if (!seen.has(key)) seen.set(key, p);
        });
    });
    return [...seen.values()];
}

function loadPools() {
    return openBoards()
        .then(() => Promise.all([loadFiles(), openRegistry(), openEvaluations(), openStages(), openBoardEntries(listBoards().map(b => b.id)), openDepthCharts(), openSetup()]))
        .then(([files]) => {
        // Base data edited in-app — players added, corrected, or removed — is
        // shared by every board, so it is applied before anything ranks,
        // places, tags or exports. From here down there is no such thing as an
        // "app-added" player: they are all just players.
        // Recorded here because this is the only place the raw files are
        // seen. Handed out with the pools so somebody can be told.
        fileDuplicates = duplicatesIn(files);

        const keyOf = joinKeyFor(files);
        const union = applyProspects(unionOfFiles(files, keyOf));

        // The one place a name becomes an identity. Every player carries a
        // stable id from here on, so nothing downstream has to re-derive who
        // he is from his name (see utils/playerRegistry.js). Resolved in one
        // batch: the name index is built once for the whole pool rather than
        // once per player.
        const ids = resolveAll(union);

        // Matrix scores used to have a store of their own. Now that every
        // player has a record to hang facts on, they move onto it — here,
        // because this is the first moment the records exist to move them to.

        // School and the draft outcome are in no rankings file, so they are
        // seeded onto the records here. AWAITED, unlike before: the pool is
        // built from those records on the very next line, and seeding after
        // the fact meant the first load produced a pool with no schools at
        // all — which is what made "group by school" put every player in
        // unmatched. It is one fetch of a file the browser then caches.
        return applyPlayerFacts().then(() => ({ files, keyOf, union, ids }));
    })
        .then(({ files, keyOf, union, ids }) => {
        // Facts come off the record, not out of the rankings file, which
        // carries an ordering and nothing else. School in particular: it is
        // seeded onto the record (see playerFacts.js) and was never copied
        // onto the pool, so anything reading player.school saw nothing —
        // grouping the board by school put all 328 players in "unmatched",
        // and the card had no school to show for anyone in the class.
        //
        // The pool's own value wins where it has one: a correction made in the
        // app is on the player object already.
        const everyone = union.map((p, i) => {
            if (!ids[i]) return p;
            const record = byId(ids[i]);
            return {
                ...p,
                id: ids[i],
                school: p.school || record?.school || '',
                athleticMatrixTotal: p.athleticMatrixTotal ?? record?.athleticMatrixTotal ?? null,
                athleticMatrixPosition: p.athleticMatrixPosition ?? record?.athleticMatrixPosition ?? null,
            };
        });

        // A player one analyst has ranked and another hasn't is not missing
        // from the second board — he is UNRANKED on it. Dropping him meant a
        // player Ryan rated highly simply did not exist on Dan's board, so
        // there was nowhere to disagree. Every board carries every player;
        // what differs is where each one has been placed.
        const pools = Object.fromEntries(Object.keys(files).map(boardId => {
            const file = files[boardId];
            if (!file?.length) return [boardId, file];

            // First row wins, matching the shared pool above and the board
            // store's own rule. It used to be `new Map(file.map(…))`, which
            // takes the LAST — so a file that rated a man twice had his
            // identity taken from the first row and his placement from the
            // last, two opposite rules eight lines apart.
            const own = new Map();
            file.forEach(p => { const k = keyOf(p); if (!own.has(k)) own.set(k, p); });
            return [boardId, everyone.map(p => {
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
        Object.keys(pools).forEach(board => {
            if (!pools[board]?.length) return;
            // The file creates the initial state and then steps out of the
            // way: after this the board lives in storage and is read from
            // there. Favourites are seeded as part of it.
            scoutingState.seedBoard(board, pools[board]);
            // A seeded entry is joined to its player here rather than by name
            // on every read.
            scoutingState.attachPlayerIds(board, pools[board]);
            scoutingState.seedFavourites(board, pools[board]);
        });

        // The shipped worked example — see exampleEvaluations.js. After the
        // boards exist and their players have ids to hang remarks on, and
        // never over anything already written.
        seedExampleEvaluations();
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

/** What the last load found wrong with the files. See duplicatesIn. */
let fileDuplicates = [];

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
    const duplicates = useMemo(() => (pools ? fileDuplicates : []), [pools]);

    const resolved = useMemo(
        () => (pools ? Object.fromEntries(Object.keys(pools).map(b => [b, pools[b]?.length ? pools[b] : fallback])) : null),
        [pools, fallback],
    );

    if (!resolved) return { pools: null, loading: true, duplicates: [] };
    return { pools: resolved, loading: false, duplicates };
}
