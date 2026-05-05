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

export const POS_TRANSLATIONS = {
    'WR.Z': 'Z-Reciever',
    'WR.X': 'X-Reciever',
    'WR.S': 'Slot',
    //'LT': 'Left Tackle',
    //'LG': 'Left Guard',
    //'//C': 'Center',
    //'RG': 'Right Guard',
    //'RT': 'Right Tackle',
    //'TE': 'Tight End',
    //'QB': 'Quarterback',
    //'RB': 'Running Back',
    //'LDE': 'Left End',
    //'RDE': 'Right End',
    'DT.3T': '3-Tech',
    'DT.1T': '1-Tech',
    //'LB.W': 'Will LB',
    //'LB.M': 'Mike LB',
    //'LB.S': 'Sam LB',
    //'CB': 'Cornerback',
    'CB.N': 'Nickel',
    //'S.F': 'Free Safety',
    //'S.S': 'Strong Safety',
    //'PT': 'Punter',
    //'PK': 'Kicker',
    //'LS': 'Long Snapper'
};


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
        cuts: [],
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
        const parsed = [];
        let rIndex = 0;
        const limit53 = slots ? parseInt(slots) : slots53ForPos(pos);

        rawSlots.forEach(s => {
            const v = s.trim();
            if (!v) return;

            let zone = '53';
            if (v.toUpperCase().startsWith('PS:')) zone = 'ps';
            else if (v.toUpperCase().startsWith('IR:')) zone = 'ir';
            else if (v.toUpperCase().startsWith('R:')) zone = 'r';
            else if (rIndex >= limit53) zone = 'r'; // Auto-overflow to reserve

            const name = v.replace(/^(PS:|IR:|R:)/i, '').trim();
            const slot = makeSlot(name, zone);

            if (zone === 'ps') {
                // Put in PS slots (indices limit53 to limit53 + 2)
                const psIdx = limit53 + (parsed.filter(x => x?.zone === 'ps').length);
                parsed[psIdx] = slot;
            } else if (zone === 'r') {
                // Put in Reserve slots (indices limit53 + 3 onwards)
                const resIdx = limit53 + 3 + (parsed.filter(x => x?.zone === 'r').length);
                parsed[resIdx] = slot;
            } else if (zone === 'ir') {
                reserve.push(name);
            } else {
                // 53-man
                parsed[rIndex++] = slot;
            }
        });

        depthChart[rowId] = parsed;

        const chip = { id: rowId, label: pos, slots53: limit53 };
        if (phase === 'O') offense.push(chip);
        else if (phase === 'D') defense.push(chip);
    }

    return { positionConfig: { offense, defense }, depthChart, reserve, cuts: [] };
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
// ---------------------------------------------------------------------------
// Ourlads Scraper (JS Conversion)
// ---------------------------------------------------------------------------

const POS_MAPPING = {
    "LWR": "WR.Z", "RWR": "WR.X", "SWR": "WR.S",
    "LDT": "DT.3T", "RDT": "DT.1T",
    "MLB": "LB.M", "WLB": "LB.W", "SLB": "LB.S",
    "LCB": "CB.L", "RCB": "CB.R", "NB": "CB.N",
    "FS": "S.F", "SS": "S.S",
    "PT": "P", "PK": "K",
};

function cleanPlayerName(raw) {
    if (!raw) return null;
    let tag = '';
    if (raw.includes("CF26")) tag = "UDFA";
    const roundMatch = raw.match(/26\/(\d)/);
    if (roundMatch) tag = roundMatch[1];

    let name = raw.replace(/\s+\S*\d{2,}.*$/, '').trim();
    name = name.replace(/[PUT]\/[a-zA-Z]+$/, '').trim();

    if (name.includes(",")) {
        const [last, first] = name.split(",");
        if (first) name = `${first.trim()} ${last.trim()}`;
    }
    return tag ? `${name}:${tag}` : name;
}

export async function fetchOurladsRoster() {
    const url = "https://www.ourlads.com/nfldepthcharts/depthchart/KC";
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

    const res = await fetch(proxyUrl);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const tables = doc.querySelectorAll('table');
    const data = {};

    tables.forEach(table => {
        const rows = Array.from(table.querySelectorAll('tr')).slice(1);
        rows.forEach(row => {
            const cols = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
            if (cols.length < 3) return;

            const pos = cols[0];
            if (["Offense", "Defense", "Special Teams", "", "H", "KO", "PR", "KR"].includes(pos)) return;

            const players = [];
            for (let i = 2; i < cols.length; i += 2) {
                const name = cleanPlayerName(cols[i]);
                if (name) players.push(name);
            }

            if (players.length > 0) {
                const basePos = POS_MAPPING[pos] || pos;
                if (!data[basePos]) data[basePos] = [];
                data[basePos].push(...players);
            }
        });
    });

    // Build the final roster state object
    const offense = [];
    const defense = [];
    const depthChart = {};
    const reserve = [];
    const posCount = {};

    Object.entries(data).forEach(([pos, players]) => {
        const slots = { "TE": 4, "QB": 3, "RB": 4, "LB.M": 3, "K": 1, "P": 1, "LS": 1 }[pos] || 2;

        let phase = 'S';
        if (/^(WR|LT|LG|C|RG|RT|TE|QB|RB)/.test(pos)) phase = 'O';
        else if (/^(LD|DT|RD|LB|CB|S|S\.)/.test(pos)) phase = 'D';

        const rowId = `${phase}-${pos}-${posCount[pos] || 0}`;
        posCount[pos] = (posCount[pos] || 0) + 1;

        const parsedSlots = players.map((name, i) => {
            return makeSlot(name, i < slots ? '53' : 'r');
        });

        depthChart[rowId] = parsedSlots;
        const chip = { id: rowId, label: pos, slots53: slots };
        if (phase === 'O') offense.push(chip);
        else if (phase === 'D') defense.push(chip);
    });

    return { positionConfig: { offense, defense }, depthChart, reserve, cuts: [] };
}
