/**
 * Roster state management + CSV import/export.
 * Stored in localStorage under key 'rosterState'.
 */

// Reasonable 53-man slot defaults by major position
const DEFAULT_SLOTS53 = {
    QB: 2, WR: 3, RB: 3, FB: 1, TE: 2,
    LT: 2, LG: 2, C: 2, RG: 2, RT: 2, OL: 2,
    DE: 2, DT: 2, NT: 1, EDGE: 2,
    OLB: 2, ILB: 2, LB: 3, MLB: 2,
    CB: 4, NB: 1, S: 3, SS: 2, FS: 2,
    P: 1, K: 1, LS: 1,
};

function slots53ForPos(posId) {
    if (DEFAULT_SLOTS53[posId] != null) return DEFAULT_SLOTS53[posId];
    const major = posId.split('.')[0];
    return DEFAULT_SLOTS53[major] ?? 2;
}

export const SPECIALIST_IDS = ['P', 'K', 'LS'];

const STORAGE_KEY = 'rosterState';

// ---------------------------------------------------------------------------
// Slot helpers
// ---------------------------------------------------------------------------
export function makeSlot(name, zone = '53') {
    return name ? { name, zone } : null;
}

export function defaultState() {
    const depthChart = {};
    SPECIALIST_IDS.forEach(id => { depthChart[id] = []; });
    return {
        positionConfig: { offense: [], defense: [] },
        depthChart,
        reserve: [],
    };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            // Only use saved state if it has actual position config
            if (parsed?.positionConfig?.offense?.length > 0) return parsed;
        }
    } catch { /* ignore */ }
    return null; // null = needs CSV bootstrap
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// CSV Import — builds positionConfig dynamically from rows
// ---------------------------------------------------------------------------

/**
 * Parse CSV into full roster state.
 * Format: Phase,pos,slot1,slot2,...
 * Phase: O | D | S
 * Slot prefix: PS: → ps zone, IR: → ir zone, else 53 zone
 *
 * The same pos label can appear multiple times (e.g. two DE rows).
 * Each row gets a unique stable id: "O-WR.L-0", "D-DE-0", "D-DE-1", etc.
 */
export function parseCSV(csvText) {
    const lines = csvText
        .trim()
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.toLowerCase().startsWith('phase'));

    const offense = [];
    const defense = [];
    const depthChart = {};
    const reserve = [];
    const posCount = {}; // tracks occurrences per "Phase-pos"

    SPECIALIST_IDS.forEach(id => { depthChart[id] = []; });

    for (const line of lines) {
        const cols = line.split(',');
        const phase = cols[0].trim().toUpperCase();
        const pos = cols[1].trim();
        const slots = cols[2].trim();
        const rawSlots = cols.slice(3);

        if (phase === 'S' && SPECIALIST_IDS.includes(pos)) {
            const name = rawSlots.find(s => s.trim())?.trim();
            depthChart[pos] = name ? [makeSlot(name, '53')] : [];
            continue;
        }

        // Assign unique row id
        const countKey = `${phase}-${pos}`;
        const idx = posCount[countKey] ?? 0;
        posCount[countKey] = idx + 1;
        const rowId = `${countKey}-${idx}`;

        // Parse slot cells
        const parsed = rawSlots.map(s => {
            const v = s.trim();
            if (!v) return null;
            if (v.toUpperCase().startsWith('PS:')) return makeSlot(v.slice(3).trim(), 'ps');
            if (v.toUpperCase().startsWith('IR:')) return makeSlot(v.slice(3).trim(), 'ir');
            if (v.toUpperCase().startsWith('R:')) return makeSlot(v.slice(2).trim(), 'r');
            return makeSlot(v, '53');
        });

        depthChart[rowId] = parsed;

        const chip = { id: rowId, label: pos, slots53: slots ? parseInt(slots) : slots53ForPos(pos) };
        if (phase === 'O') offense.push(chip);
        else if (phase === 'D') defense.push(chip);
    }

    return { positionConfig: { offense, defense }, depthChart, reserve };
}

// ---------------------------------------------------------------------------
// CSV Export — emits `label` (not internal `id`) in the pos column
// ---------------------------------------------------------------------------
export function exportCSV(state) {
    const maxSlots = Math.max(
        ...Object.values(state.depthChart).map(arr => arr.length),
        5
    );
    const headers = ['Phase', 'pos', ...Array.from({ length: maxSlots }, (_, i) => `slot${i + 1}`)];
    const rows = [headers.join(',')];

    const addRows = (phase, positions) => {
        positions.forEach(p => {
            const slots = state.depthChart[p.id] ?? [];
            const cells = slots.map(s => {
                if (!s) return '';
                if (s.zone === 'ps') return `PS:${s.name}`;
                if (s.zone === 'ir') return `IR:${s.name}`;
                return s.name;
            });
            // use p.label (e.g. "DE") not p.id ("D-DE-0")
            rows.push([phase, p.label, ...cells].join(','));
        });
    };

    addRows('O', state.positionConfig.offense);
    addRows('D', state.positionConfig.defense);
    SPECIALIST_IDS.forEach(id => {
        const s = state.depthChart[id]?.[0];
        rows.push(['S', id, s ? s.name : ''].join(','));
    });

    return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Auto-assign (for manual add, not CSV import)
// ---------------------------------------------------------------------------
export function resolvePosition(declaredPos, positionConfig, depthChart) {
    const allPositions = [...positionConfig.offense, ...positionConfig.defense];

    // Exact label match
    const exactMatches = allPositions.filter(p => p.label === declaredPos);
    if (exactMatches.length > 0) {
        // Pick the row with fewest players
        exactMatches.sort((a, b) => {
            const lenA = (depthChart[a.id] ?? []).filter(Boolean).length;
            const lenB = (depthChart[b.id] ?? []).filter(Boolean).length;
            return lenA - lenB;
        });
        return exactMatches[0].id;
    }

    // Major position match (WR.L → WR prefix)
    const major = declaredPos.split('.')[0];
    const majorMatches = allPositions.filter(p => p.label.split('.')[0] === major);
    if (majorMatches.length > 0) {
        majorMatches.sort((a, b) => {
            const lenA = (depthChart[a.id] ?? []).filter(Boolean).length;
            const lenB = (depthChart[b.id] ?? []).filter(Boolean).length;
            return lenA - lenB;
        });
        return majorMatches[0].id;
    }

    return null; // → reserve
}
