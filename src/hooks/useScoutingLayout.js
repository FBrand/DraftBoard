import { useSyncExternalStore } from 'react';

/**
 * How much of Scouting fits, decided one piece at a time.
 *
 * There used to be a single mobile/desktop switch at 1024px and everything
 * moved at once. Just above it you got the desktop arrangement with 280px of
 * ranking and 572px of side panel taking 852px of a 1025px window, leaving
 * ~170px for the player names — and just below it the ranking, the unmatched
 * column and the card all vanished together and one column of names sat in a
 * thousand pixels of empty space. A cliff in both directions.
 *
 * So the pieces go in size order instead, each with the width it actually
 * needs:
 *
 *   1. The list sheds columns on its own. `columns: 300px` fits as many as
 *      will hold a name and no more, so this needs no breakpoint at all — it
 *      follows whatever width the list ends up with.
 *   2. Then the side panel goes, and the player card becomes a modal. It is
 *      the widest fixed thing on screen, and a card pinned to an edge with no
 *      room beside it is worse than one in the middle.
 *   3. The ranking goes last, and only when it and a single column of names no
 *      longer fit together. It is the thing you are working ON.
 */
const RANKING_W = 280;      // .scouting-layout .left-panel
const SIDE_PANEL_W = 572;   // .sg-unmatched-panel, and the card that floats over it
// Measured, not guessed: the intrinsic width of the widest row the list can
// produce — "??? Emmanuel McNeil-Warren   no position, school, rank" — is
// 377px. Narrower than that and the longest names wrap or lose their meta.
// Rounded to 380, which is what .sg-group-body asks multicol for.
const COL_W = 380;
const LIST_PADDING = 32;    // .sg-group-body { padding: 4px 8px 0 } plus .sg-list's own

// What the LIST has to be for one column to reach that width — the padding
// comes off before multicol sees it, which is 32px the thresholds forgot.
const COL_MIN = COL_W + LIST_PADDING;

/** Ranking + one column of names + the side panel. */
export const SIDE_PANEL_MIN = RANKING_W + COL_MIN + SIDE_PANEL_W; // 1264

/** Ranking + one column of names. Below this the ranking is what gives way. */
export const RANKING_MIN = RANKING_W + COL_MIN; // 692

const queries = {
    showSidePanel: `(min-width: ${SIDE_PANEL_MIN}px)`,
    showRanking: `(min-width: ${RANKING_MIN}px)`,
};

const mqls = typeof window !== 'undefined' && window.matchMedia
    ? Object.fromEntries(Object.entries(queries).map(([k, q]) => [k, window.matchMedia(q)]))
    : null;

// One snapshot object per distinct state, because useSyncExternalStore compares
// by identity and a fresh object every call is an infinite render.
const DESKTOP = { showRanking: true, showSidePanel: true };
const MEDIUM = { showRanking: true, showSidePanel: false };
const NARROW = { showRanking: false, showSidePanel: false };

function snapshot() {
    if (!mqls) return DESKTOP;
    if (mqls.showSidePanel.matches) return DESKTOP;
    return mqls.showRanking.matches ? MEDIUM : NARROW;
}

function subscribe(cb) {
    if (!mqls) return () => {};
    const list = Object.values(mqls);
    list.forEach(m => m.addEventListener('change', cb));
    return () => list.forEach(m => m.removeEventListener('change', cb));
}

export default function useScoutingLayout() {
    return useSyncExternalStore(subscribe, snapshot, () => DESKTOP);
}
