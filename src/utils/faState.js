/**
 * Free Agency candidate pool state. Deliberately the SAME shape as
 * rosterState.js ({positionConfig, depthChart, reserve, cuts}) — slots here
 * hold candidates being considered for a need, not signed players — so it
 * can render through the identical DepthChartGrid with zero shape
 * translation, and reuses rosterState's parseCSV/exportCSV/defaultState/
 * makeSlot directly rather than duplicating them.
 *
 * This is a needs-and-candidates snapshot tool, not a signing tracker: no
 * timestamps, no deal terms, no event log. See
 * /home/dev/.claude/plans/structured-growing-cat.md section 3 for why.
 */
import { defaultState, parseCSV, exportCSV } from './rosterState';

const STORAGE_KEY = 'fa_state_v1';

export { parseCSV, exportCSV };

export function hasSavedState() {
    try {
        return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
        return false;
    }
}

/**
 * Free agency starts from where last season ended — the roster you actually
 * carry into it, minus everyone acquired since. That file is derived from
 * roster.csv's own provenance suffixes (:FA, :UDFA and bare 2026 round
 * numbers mark 2026 acquisitions; :YY/R and unsuffixed names are holdovers),
 * so it stays consistent with the roster it came from rather than being a
 * separately maintained list.
 */
export async function fetchSeasonStartRoster() {
    const res = await fetch(`${import.meta.env.BASE_URL}roster_2025_end.csv`);
    if (!res.ok) throw new Error(`Could not load last season's roster (HTTP ${res.status})`);
    return parseCSV(await res.text());
}

/**
 * Writes the season-start roster into free agency if nothing is saved yet, and
 * resolves with whatever FA should now hold.
 *
 * Called at app start rather than only when the Free Agency tab is opened:
 * "Roster: sync from FA/Draft/UDFA" reads free agency out of storage, so a
 * seed that waited for a visit meant the pipeline silently had nothing to pull
 * from until you happened to click the tab. Idempotent, and shared by both
 * callers so there is one implementation of what seeding means.
 */
let seedPromise = null;

export function ensureSeeded() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
        if (hasSavedState()) return loadState();
        try {
            const seeded = await fetchSeasonStartRoster();
            saveState(seeded);
            return seeded;
        } catch {
            return loadState(); // leave FA empty rather than blocking
        }
    })();
    return seedPromise;
}

// Same versioning contract as rosterState — see the note there. Unversioned
// data is treated as version 1, which is what it is.
export const STATE_VERSION = 1;

function migrate(parsed) {
    const from = typeof parsed.version === 'number' ? parsed.version : 1;
    if (from > STATE_VERSION) return null; // written by a newer app
    // (no migration steps yet)
    return { ...parsed, version: STATE_VERSION };
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.positionConfig) return migrate(parsed) ?? defaultState();
        }
    } catch { /* ignore */ }
    return defaultState();
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
}

/**
 * Read-only against Roster's real depth chart — never writes to it, and
 * takes rosterSnapshot as a parameter (rosterState.loadState()'s result)
 * rather than reading it internally, so it's pure and easy to test. Keyed
 * by label, not row id, since FA's own positionConfig rows are separate
 * from Roster's and won't share ids.
 */
export function computePositionNeed(rosterSnapshot) {
    const needs = {};
    if (!rosterSnapshot) return needs;
    const { positionConfig, depthChart } = rosterSnapshot;
    [...(positionConfig?.offense ?? []), ...(positionConfig?.defense ?? [])].forEach(p => {
        const slots = depthChart?.[p.id] ?? [];
        const s53 = Math.max(p.slots53, 1);
        const filled = slots.slice(0, s53).filter(Boolean).length;
        needs[p.label] = { filled, target: s53, stillNeed: Math.max(0, s53 - filled) };
    });
    return needs;
}
