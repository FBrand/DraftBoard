import { useEffect, useMemo, useState } from 'react';
import { openProspects } from '../data/prospectStore';
import { openStages } from '../data/stageStore';
import { openBoardEntries } from '../data/boardEntries';
// One derivation of "who is in this class", shared with the draft — which
// used to parse the rankings CSV instead and rendered nothing the day the
// CSVs stopped being deployed. See data/boardPool.js.
import { castFromEntries as poolFromEntries } from '../data/boardPool';
import { openDepthCharts } from '../data/depthChartStore';
import { openSetup } from '../utils/seasonInit';
import { applyProspects } from '../utils/prospects';
import { identityKey, nameKey } from '../utils/nameMatcher';
import { resolveAll, openRegistry, byId } from '../utils/playerRegistry';
import { storedIdentities, storedIdFor } from '../utils/storedIdentity';


import { openBoards, listBoards, viewedSeason } from '../utils/boardRegistry';
import { openEvaluations } from '../utils/evaluations';


/**
 * A board's pool comes from its ENTRIES. Nothing fetches a rankings file.
 *
 * `loadFiles()` used to fetch and parse one per board. It already skipped a
 * seeded board — the entries are a superset and carry the player id — so on a
 * seeded project it fetched nothing and existed for the first run. There is no
 * first run in the app any more: a local store is filled from the snapshot the
 * seeder built, and a shared one is seeded from outside before anybody signs in.
 *
 * So the app reads what is there. A text file shipped alongside it is not a
 * source of truth it gets to consult.
 */

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


/**
 * Which boards' entries to read at boot.
 *
 * Every board holds an entry per player — 328 each here, four boards, 1,312
 * documents — and only Scouting ever looks at more than one of them at a
 * time. On the free tier that is most of a page load's read budget spent on
 * three boards nobody has opened.
 *
 * Scouting asks for all of them (see its own note about the info card paging
 * between analysts' takes). Everything else takes the active board alone,
 * which is enough because of what the OTHER consumers actually need:
 *
 *   - the pool, which a seeded board rebuilds from its own entries;
 *   - storedIdentities, which reuses ids already written down so resolveAll
 *     does not have to fuzzy-match names again.
 *
 * Both are satisfied by one board, because seedBoard materialises a placement
 * for every player in the union rather than only the ones a file ranked — so
 * any single seeded board carries the whole cast. A board that somehow does
 * not simply contributes fewer known ids, and the names it misses fall
 * through to the matcher exactly as they did before any of this existed.
 */
function boardsToOpen(all) {
    const boards = listBoards();
    if (all) return boards.map(b => b.id);
    const slug = (() => {
        try { return new URLSearchParams(window.location.search).get('board') ?? ''; }
        catch { return ''; }
    })();
    const active = boards.find(b => b.slug === slug) ?? boards[0];
    return active ? [active.id] : [];
}

function loadPools({ allBoards = false } = {}) {
    return openBoards()
        .then(() => Promise.all([openRegistry(), openEvaluations(), openStages(viewedSeason()?.id ?? null), openProspects(viewedSeason()?.id ?? null), openBoardEntries(boardsToOpen(allBoards)), openDepthCharts(viewedSeason()?.id ?? null), openSetup(viewedSeason()?.id ?? null)]))
        .then(() => {
        // Each board's pool, from its own entries. Every entry carries the
        // player id, so nothing here matches a name.
        const files = Object.fromEntries(listBoards().map((b) => {
            const fromEntries = poolFromEntries(b.id);
            return [b.id, fromEntries.length ? fromEntries : null];
        }));
        // Base data edited in-app — players added, corrected, or removed — is
        // shared by every board, so it is applied before anything ranks,
        // places, tags or exports. From here down there is no such thing as an
        // "app-added" player: they are all just players.
        // Recorded here because this is the only place the raw files are
        // seen. Handed out with the pools so somebody can be told.
        fileDuplicates = duplicatesIn(files);

        const keyOf = joinKeyFor(files);
        const union = applyProspects(unionOfFiles(files, keyOf));

        // Identity from what is already written down, not from matching names
        // again.
        //
        // resolveAll below fuzzy-matches every name in the pool against the
        // registry. Profiling a boot put getLevenshteinDistance at the top of
        // the list by self time, with findMatchingIndex behind it — and almost
        // all of that work re-derives an answer the app already has. A board
        // entry IS the answer: its document key is the player's registry id,
        // which is why the body deliberately stores no playerId of its own.
        //
        // So the entries are read first and the matcher only sees names none
        // of them account for — a genuinely new prospect, or a first run where
        // there are no entries yet and this map is empty. Nothing is
        // persisted, so there is no stale mapping to invalidate: the map is
        // rebuilt from storage on every load, and a name it does not answer
        // for falls through to exactly the code that ran before.
        const stored = storedIdentities();
        const fromEntries = union.map(p => storedIdFor(stored, p));

        const unresolved = [];
        fromEntries.forEach((id, i) => { if (!id) unresolved.push(i); });
        const ids = fromEntries;
        if (unresolved.length) {
            const found = resolveAll(unresolved.map(i => union[i]));
            unresolved.forEach((at, j) => { ids[at] = found[j] ?? null; });
        }
        if (globalThis.__DB_TRACE) {
            console.log(`[trace] pool: ${union.length} players, ${unresolved.length} needed resolving by name`);
        }

        // Matrix scores used to have a store of their own. Now that every
        // player has a record to hang facts on, they move onto it — here,
        // because this is the first moment the records exist to move them to.

        // School and the draft outcome are in no rankings file, so they are
        // seeded onto the records here. AWAITED, unlike before: the pool is
        // built from those records on the very next line, and seeding after
        // the fact meant the first load produced a pool with no schools at
        // all — which is what made "group by school" put every player in
        // unmatched. It is one fetch of a file the browser then caches.
        // The shipped facts file used to be applied here. It is the seeder's
        // now — a player arrives with his school and his draft outcome already
        // on him, because the snapshot was built from the same file. An app that
        // re-applies it is an app deciding what a player is from a text file it
        // happens to ship, which is the whole class of thing being removed.
        return Promise.resolve({ files, keyOf, union, ids });
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
            // A board with NO rankings file is the same case with an empty
            // file: it carries every player, all of them unranked. That is
            // what a board created in the app is, and what its own dialog
            // promises — "every player starts unranked".
            //
            // This used to return the file's own emptiness, which reads as
            // "there is no pool for this board", and the consumer then fell
            // back to the DEFAULT pool: `pools?.[activeBoard] ?? players`.
            // So a brand new empty board opened showing the consensus board's
            // placements — 313 ranked players, none of them its own, and it
            // survived a reload because nothing about it was stale.
            const file = files[boardId] ?? [];

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

        // A board's placements used to be SEEDED here, from its rankings file:
        // seedBoard materialised an entry per player, attachPlayerIds joined
        // them, seedFavourites turned a `*` into a tag. All three are the
        // seeder's now, and the entries arrive in the snapshot already joined.
        //
        // What this cost while it lived here: every board was handed the full
        // union as its pool whether its own entries had loaded or not, so an
        // unread board looked empty and got all 328 placements rewritten from
        // the file. On a board somebody else owned every one of those writes was
        // refused — 328 entries and the board's own stamp, 329 failures for the
        // act of opening a board.
        // The worked example was seeded here. It is in the snapshot now, filed
        // under Dan by the seeder, so there is nothing for the app to write.
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

/**
 * Forgets the BOARD LIST as well as the pools.
 *
 * `loadFiles` reads `listBoards()` once and caches the promise for the life of
 * the page, so a board created after that read is in neither `files` nor
 * `pools` — and a board missing from `pools` falls back to the default pool at
 * `pools?.[activeBoard] ?? players`. A new empty board therefore opened showing
 * the consensus board's placements until the page was reloaded.
 *
 * Kept distinct from `invalidatePools` because callers distinguish them, though
 * there is no longer a file cache to drop: a pool is rebuilt from the board
 * entries, which is what both of these now mean.
 */
export function invalidateBoards() {
    invalidatePools();
}

/** What the last load found wrong with the files. See duplicatesIn. */
let fileDuplicates = [];

export default function useBoardRankings(fallback, { allBoards = false } = {}) {
    const [pools, setPools] = useState(null);
    const [gen, setGen] = useState(generation);

    useEffect(() => {
        const bump = () => setGen(generation);
        listeners.add(bump);
        return () => { listeners.delete(bump); };
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadPools({ allBoards }).then(loaded => { if (!cancelled) setPools(loaded); });
        return () => { cancelled = true; };
    }, [gen, allBoards]);

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
