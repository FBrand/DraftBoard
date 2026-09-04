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

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.positionConfig) return parsed;
        }
    } catch { /* ignore */ }
    return defaultState();
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
