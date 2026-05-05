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
    //'C': 'Center',
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
            if (parsed?.positionConfig?.offense?.length > 0) return parsed;
        }
    } catch { /* ignore */ }
    return null;
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// CSV Import
// ---------------------------------------------------------------------------

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
    const posCount = {};

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

        const countKey = `${phase}-${pos}`;
        const idx = posCount[countKey] ?? 0;
        posCount[countKey] = idx + 1;
        const rowId = `${countKey}-${idx}`;

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
            else if (rIndex >= limit53) zone = 'r';

            const name = v.replace(/^(PS:|IR:|R:)/i, '').trim();
            const slot = makeSlot(name, zone);

            if (zone === 'ps') {
                const psIdx = limit53 + (parsed.filter(x => x?.zone === 'ps').length);
                parsed[psIdx] = slot;
            } else if (zone === 'r') {
                const resIdx = limit53 + 3 + (parsed.filter(x => x?.zone === 'r').length);
                parsed[resIdx] = slot;
            } else if (zone === 'ir') {
                reserve.push(name);
            } else {
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

export function exportCSV(state) {
    const maxSlots = Math.max(...Object.values(state.depthChart).map(arr => arr.length), 5);
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

export function resolvePosition(declaredPos, positionConfig, depthChart) {
    const allPositions = [...positionConfig.offense, ...positionConfig.defense];
    const exactMatches = allPositions.filter(p => p.label === declaredPos);
    if (exactMatches.length > 0) {
        exactMatches.sort((a, b) => {
            const lenA = (depthChart[a.id] ?? []).filter(Boolean).length;
            const lenB = (depthChart[b.id] ?? []).filter(Boolean).length;
            return lenA - lenB;
        });
        return exactMatches[0].id;
    }
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
    return null;
}

// ---------------------------------------------------------------------------
// Scraper Helpers
// ---------------------------------------------------------------------------

const POS_MAPPING = {
    "LWR": "WR.Z", "RWR": "WR.X", "SWR": "WR.S",
    "LDT": "DT.3T", "RDT": "DT.1T",
    "MLB": "LB.M", "WLB": "LB.W", "SLB": "LB.S",
    "LCB": "CB.L", "RCB": "CB.R", "NB": "CB.N",
    "FS": "S.F", "SS": "S.S",
    "PT": "P", "PK": "K",
};

/**
 * Enhanced player cleaning with status metadata.
 */
function cleanPlayerNameWithStatus(el) {
    if (!el) return null;
    const raw = el.textContent.trim();
    if (!raw) return null;

    let tag = '';
    const className = el.className || '';

    if (className.includes('lc_aqua')) tag = "UDFA";
    else if (className.includes('lc_gold')) tag = "FA";
    else if (className.includes('lc_red')) tag = "IR";
    else if (className.includes('lc_purple')) {
        const roundMatch = raw.match(/2\d\/(\d)/);
        tag = roundMatch ? roundMatch[1] : "RP";
    }

    if (!tag) {
        if (raw.includes("CF26")) tag = "UDFA";
        const roundMatch = raw.match(/\d{2}\/(\d)/);
        if (roundMatch) tag = roundMatch[0];
    }

    let name = raw.replace(/\s+\S*\d{2,}.*$/, '').trim();
    name = name.replace(/[PUT]\/[a-zA-Z]+$/, '').trim();

    if (name.includes(",")) {
        const parts = name.split(",");
        const last = parts[0];
        const first = parts.slice(1).join(",").trim();
        if (first) name = `${first} ${last.trim()}`;
    }
    return tag ? `${name}:${tag}` : name;
}

export function parseHTMLToRoster(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allTables = Array.from(doc.querySelectorAll('table.table-bordered'));
    const tables = allTables.filter(t => t.rows[0]?.cells.length >= 3).slice(0, 3);

    // Use an accumulator to merge positions
    const mergedData = { O: {}, D: {}, S: {} };

    tables.forEach((table, tableIdx) => {
        const phaseLabel = tableIdx === 0 ? 'O' : (tableIdx === 1 ? 'D' : 'S');
        const rows = Array.from(table.querySelectorAll('tr')).slice(1);

        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 3) return;

            const rawPos = cells[0].textContent.trim();
            if (!rawPos || ["Offense", "Defense", "Special Teams", "H", "KO", "PR", "KR"].includes(rawPos)) return;

            const players = [];
            for (let i = 2; i < cells.length; i += 2) {
                const playerLink = cells[i].querySelector('a');
                const nameWithStatus = cleanPlayerNameWithStatus(playerLink || cells[i]);
                if (nameWithStatus) players.push(nameWithStatus);
            }
            if (players.length === 0) return;

            const pos = POS_MAPPING[rawPos] || rawPos;

            if (!mergedData[phaseLabel][pos]) mergedData[phaseLabel][pos] = [];
            mergedData[phaseLabel][pos].push(...players);
        });
    });

    const offense = [], defense = [], depthChart = {};

    ['O', 'D', 'S'].forEach(phase => {
        Object.entries(mergedData[phase]).forEach(([pos, players]) => {
            if (phase === 'S' && SPECIALIST_IDS.includes(pos)) {
                depthChart[pos] = [makeSlot(players[0], '53')];
                return;
            }

            const slots = { "TE": 4, "QB": 3, "RB": 4, "LB.M": 3, "K": 1, "P": 1, "LS": 1 }[pos] || 2;
            const rowId = `${phase}-${pos}-0`; // We only have one merged row now

            const parsed = [];
            players.forEach((name, i) => {
                if (i < slots) {
                    parsed[i] = makeSlot(name, '53');
                } else {
                    const resIdx = slots + 3 + (i - slots);
                    parsed[resIdx] = makeSlot(name, 'r');
                }
            });

            depthChart[rowId] = parsed;
            const chip = { id: rowId, label: pos, slots53: slots };
            if (phase === 'O') offense.push(chip);
            else if (phase === 'D') defense.push(chip);
        });
    });

    return { positionConfig: { offense, defense }, depthChart, reserve: [], cuts: [] };
}

export async function fetchOurladsRoster() {
    const url = "https://www.ourlads.com/nfldepthcharts/depthchart/KC";
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;

    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("Network fetch failed");
    const html = await res.text();
    if (!html) throw new Error("Empty response from proxy");

    return parseHTMLToRoster(html);
}

export async function fetchLocalRoster() {
    const res = await fetch('/roster.csv');
    if (!res.ok) throw new Error("Could not find local roster.csv");
    const text = await res.text();
    return parseCSV(text);
}
