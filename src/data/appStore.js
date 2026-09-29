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

/**
 * Collections served by the layered store. Everything else is the
 * repository's. Add to this only when the module owning the collection has
 * actually moved, and only when nothing else reads it.
 */
export const MIGRATED = ['evaluations'];

/** Whether a path belongs to the layered store. */
export function isMigrated(path) {
    return MIGRATED.some(c => path === c || path.startsWith(`${c}/`));
}

export const store = createStore(fromLegacyAdapter(repository.adapter));
