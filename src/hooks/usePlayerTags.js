import { useMemo, useCallback, useEffect, useState } from 'react';
import * as scoutingState from '../utils/scoutingState';
import { buildNameIndex, findMatchingIndex } from '../utils/nameMatcher';

import { listBoards } from '../utils/boardRegistry';
import { repository } from '../data/repository';
import { entriesPath } from '../data/boardEntries';

/**
 * Which scouting board belongs to the rankings currently loaded.
 *
 * Draft and UDFA load one rankings file (via `?rankings=`), and each file has
 * a scouting board behind it. Showing tags from the wrong analyst's board
 * would be worse than showing none, so this matches on the filename rather
 * than assuming consensus.
 */
export function boardForCurrentRankings() {
    const boards = listBoards();
    const fallback = boards[0]?.id ?? null;
    try {
        const url = new URLSearchParams(window.location.search).get('board') ?? '';
        const match = boards.find(b => b.rankingsFile && url.includes(b.rankingsFile));
        return match?.id ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * Builds the id map alongside the existing fuzzy index — a plain function,
 * not a hook, so it's directly testable without rendering anything.
 */
export function loadTagIndex(entries) {
    const byId = new Map();
    entries.forEach((e, i) => { if (e.playerId) byId.set(e.playerId, i); });
    return { entries, index: buildNameIndex(entries), byId };
}

/**
 * The lookup itself, id-first — a plain function so the decision (not just
 * the data shape above) is directly testable too. This runs once per
 * rendered card on the Draft/UDFA board, a real render-loop path, not a
 * click handler: both sides already carry an id (the board pool's player,
 * and this board's entries) by the time this is called, so only fall back to
 * a fuzzy scan — an O(n) scan, versus an O(1) map lookup, which is the whole
 * reason to prefer the id path here specifically — when it genuinely can't
 * answer (no id on the qualifier, or a stale one).
 */
export function tagFor(name, qualifier, loaded) {
    if (!loaded.entries.length) return null;
    const idHit = qualifier?.id != null ? loaded.byId.get(qualifier.id) : undefined;
    const i = idHit !== undefined ? idHit : findMatchingIndex(name, loaded.index, qualifier);
    return i !== -1 && i !== undefined ? loaded.entries[i].tag ?? null : null;
}

/**
 * Returns `tagFor(name, player)` — the scouting tag for a player on the given
 * board, so the draft board can draw the same markers Scouting does.
 * Read-only, and re-read once per board rather than watched: tags are edited
 * in Scouting, which is a different screen, so this only has to be right as
 * of the moment the board is opened.
 */
export default function usePlayerTags(board = null) {
    const key = board ?? boardForCurrentRankings();
    const [fresh, setFresh] = useState(0);

    // Re-read the board's entries when it opens, because "loaded at boot" is
    // not the same as "current".
    //
    // Entries are read once at startup (useBoardRankings' openBoardEntries)
    // and after that only ScoutingView follows them. So a tag another expert
    // set on his own device reached this one's Draft and UDFA boards only
    // once somebody opened Scouting and that subscription pulled it into the
    // shared in-memory copy — which is exactly what it looked like: the
    // marker appeared on the card after a detour through another stage.
    //
    // One read per board opened, and deliberately NOT a follow(): a tag is
    // not a draft pick, nobody is watching the board for it to change under
    // them, and a listener per viewer for something edited on another screen
    // is not worth the stream.
    //
    // invalidate() is safe HERE and would not be everywhere: it calls
    // stopWatching(), which tears down any live subscription on the path and
    // does not put it back — follow()'s own refcount would be left pointing
    // at a watcher that no longer exists, and the subscriber would go quiet
    // for good. It cannot happen from here. ScoutingView is the only thing
    // that follows this path, App.jsx renders one view at a time, and this
    // hook is only ever called from DraftView and UdfaView — so Scouting is
    // always unmounted, and its watcher already stopped, by the time this
    // runs.
    useEffect(() => {
        if (!key || !repository.isLive()) return undefined;
        let cancelled = false;
        const path = entriesPath(key);
        repository.invalidate(path);
        repository.ready(path).then(() => { if (!cancelled) setFresh(n => n + 1); });
        return () => { cancelled = true; };
    }, [key]);

    // Memoise the data, not a closure over it — a useMemo that returns a
    // function defeats the React compiler's memoisation checks.
    //
    // `fresh` is what carries the re-read above into the render. invalidate()
    // deliberately does not notify, so nothing re-renders while the
    // collection is empty mid-flight: this keeps showing the tags it already
    // had until the new ones have actually arrived.
    const loaded = useMemo(() => {
        const entries = key ? scoutingState.loadState(key)?.entries ?? [] : [];
        return loadTagIndex(entries);
        // `fresh` looks unused to the linter because loadState() reads the
        // repository rather than anything in this closure — which is exactly
        // why it has to be a dependency: it is the only signal that the store
        // underneath changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, fresh]);

    return useCallback((name, qualifier) => tagFor(name, qualifier, loaded), [loaded]);
}
