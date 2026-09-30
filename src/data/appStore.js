/**
 * The app's layered store, alongside the repository while stores move across.
 *
 * REBUILD-PLAN.md §3 lands the seam and the precedence model one store at a
 * time rather than as a rewrite of everything that touches storage, because
 * that rewrite has no intermediate state in which the app runs. So both exist
 * for a while, and the rule that keeps them from disagreeing is simple:
 *
 *     a collection belongs to exactly one of them.
 *
 * A collection read through both would have two caches over one backend and
 * they would drift — which is the same class of fault as the one this whole
 * phase exists to fix, so it is worth being blunt about. `MIGRATED` below is
 * the list, and it is the thing to check before moving anything.
 *
 * It shares the repository's ADAPTER rather than building its own. Two adapter
 * instances would be two separate stores against a memory backend, and the
 * unit suite runs on memory — the divergence would show up as tests passing
 * for the wrong reason.
 */
import { repository } from './repository';
import { createStore } from './store';
import { fromLegacyAdapter } from './contract';
import { onReset } from './storeRegistry';

/**
 * Collections served by the layered store. Everything else is the repository's.
 *
 * PATTERNS, not names, because every remaining candidate embeds an id in its
 * path — `seasons/{seasonId}/prospects`, `boards/{boardId}/entries` — and a list
 * of names cannot express those. Prefixing on `seasons` would have captured
 * every stage at once, which is the opposite of moving one collection at a time.
 *
 * Add to this only when the module owning the collection has actually moved, and
 * only when nothing else reads it. The two that are watched — `players` and
 * `draft_state` — move LAST: the live draft follows them, and a watch is the one
 * thing the newer seam still forwards to the old adapter.
 */
export const MIGRATED = [
    /^evaluations(\/|$)/,
    // The prospect records: players added in the app, corrections to file
    // players, and players hidden. One owner (utils/prospects.js), nothing
    // watches them, three collections — the cleanest thing to move first.
    /^seasons\/[^/]+\/prospects(\/|$)/,
    /^seasons\/[^/]+\/prospect_edits(\/|$)/,
    /^seasons\/[^/]+\/prospect_hidden(\/|$)/,
    // Single owner, nothing watches them.
    /^seasons\/[^/]+\/stages(\/|$)/,
    /^seasons\/[^/]+\/setup(\/|$)/,
];

/**
 * Whether a path belongs to the layered store.
 *
 * Worth asking rather than assuming: this had no caller at all, so nothing
 * enforced the split and it was a comment with a function signature. Anything
 * that routes a read should ask it, or the two stores drift over a collection
 * both think they own.
 */
export function isMigrated(path) {
    return MIGRATED.some(pattern => pattern.test(path));
}

/**
 * Built on FIRST USE, not at module scope.
 *
 * `createStore(fromLegacyAdapter(repository.adapter))` needs the repository
 * INITIALISED, not merely imported, and there is a cycle that makes the
 * difference matter: data/backend imports utils/auth, which reaches
 * boardRegistry, which reaches a store module, which reaches back here. Whoever
 * happens to be first in that ring gets a `repository` that is still undefined —
 * measured as `Cannot read properties of undefined (reading 'adapter')` across
 * most of the suite the moment a second collection moved across.
 *
 * A getter defers the question until somebody actually reads or writes, which is
 * always after every module in the ring has finished evaluating. The proxy keeps
 * the call sites unchanged: `store.ready(...)` still reads as a store.
 */
let instance = null;
const real = () => (instance ??= createStore(fromLegacyAdapter(repository.adapter)));

export const store = new Proxy({}, {
    get(_target, prop) {
        const value = real()[prop];
        return typeof value === 'function' ? value.bind(real()) : value;
    },
    has(_target, prop) { return prop in real(); },
});

/** Drops the instance, so a test can point it at a fresh adapter. */
export function resetStore() { instance = null; }

// Registered rather than imported by the suite: see storeRegistry for why.
onReset(resetStore);
