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

// RFC-4180-style quote-aware split: a plain `line.split(',')` corrupts any
// field containing a literal comma — and Ourlads' own "Last, First" name
// convention makes that a real, not just theoretical, input (players signed
// or pasted in that format silently split into two garbled reserve/cut
// entries on export/re-import). Handles quoted fields and doubled-quote
// escaping; doesn't handle a quoted field spanning multiple physical lines,
// since parseCSV splits on '\n' before this ever runs.
function parseCsvLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            fields.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    fields.push(cur);
    return fields;
}

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
    const cuts = [];
    const posCount = {};

    SPECIALIST_IDS.forEach(id => { depthChart[id] = []; });

    for (const line of lines) {
        const cols = parseCsvLine(line);
        const phase = cols[0].trim().toUpperCase();

        if (phase === 'IR') {
            const col2 = cols[2]?.trim() ?? '';
            const parsedSlots = parseInt(col2);
            const hasSlots53Col = !isNaN(parsedSlots);
            const rawSlots = hasSlots53Col ? cols.slice(3) : cols.slice(2);
            const names = rawSlots.map(s => s.trim()).filter(Boolean).map(n => n.replace(/^(PS:|IR:|R:)/i, '').trim());
            reserve.push(...names);
            continue;
        }
        if (phase === 'CUT' || phase === 'CUTS') {
            const col2 = cols[2]?.trim() ?? '';
            const parsedSlots = parseInt(col2);
            const hasSlots53Col = !isNaN(parsedSlots);
            const rawSlots = hasSlots53Col ? cols.slice(3) : cols.slice(2);
            const names = rawSlots.map(s => s.trim()).filter(Boolean).map(n => n.replace(/^(PS:|IR:|R:)/i, '').trim());
            cuts.push(...names);
            continue;
        }

        const pos = cols[1]?.trim() ?? '';
        const col2 = cols[2]?.trim() ?? '';
        const parsedSlots = parseInt(col2);
        // col2 is slots53 if it's a number (exported format), otherwise it's slot1 (legacy hand-edited format)
        const hasSlots53Col = !isNaN(parsedSlots);
        const rawSlots = hasSlots53Col ? cols.slice(3) : cols.slice(2);
        const explicitSlots53 = hasSlots53Col ? parsedSlots : null;

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
        const limit53 = explicitSlots53 ?? slots53ForPos(pos);

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

    return { positionConfig: { offense, defense }, depthChart, reserve, cuts };
}

// Counterpart to parseCsvLine: quote any field containing a comma, quote
// character, or newline (RFC 4180 style), doubling embedded quotes. Without
// this, a name like Ourlads' "Last, First" convention silently expands into
// extra columns on export.
function csvField(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export function exportCSV(state) {
    const maxSlots = Math.max(...Object.values(state.depthChart).map(arr => arr.length), 5);
    const headers = ['Phase', 'pos', 'slots53', ...Array.from({ length: maxSlots }, (_, i) => `slot${i + 1}`)];
    const rows = [headers.map(csvField).join(',')];

    const addRows = (phase, positions) => {
        positions.forEach(p => {
            const slots = state.depthChart[p.id] ?? [];
            const cells = slots.map(s => {
                if (!s) return '';
                if (s.zone === 'ps') return `PS:${s.name}`;
                if (s.zone === 'ir') return `IR:${s.name}`;
                if (s.zone === 'r') return `R:${s.name}`;
                return s.name;
            });
            rows.push([phase, p.label, p.slots53, ...cells].map(csvField).join(','));
        });
    };

    addRows('O', state.positionConfig.offense);
    addRows('D', state.positionConfig.defense);
    SPECIALIST_IDS.forEach(id => {
        const s = state.depthChart[id]?.[0];
        rows.push(['S', id, s ? s.name : ''].map(csvField).join(','));
    });
    if (state.reserve && state.reserve.length > 0) {
        rows.push(['IR', 'IR', '', ...state.reserve].map(csvField).join(','));
    }
    if (state.cuts && state.cuts.length > 0) {
        rows.push(['CUT', 'CUT', '', ...state.cuts].map(csvField).join(','));
    }
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

// Roster auto-fetch is a pluggable adapter, same pattern as Draft's live sync
// (see useDraftState.js's ESPNProvider discovery): the module is discovered
// via import.meta.glob so the app builds and runs fine with it absent, same
// as ESPNProvider.js — this one just doesn't exist yet. The previous
// hardcoded fetch here pulled directly
// from ourlads.com via a public CORS proxy — dropped because Ourlads' Terms
// explicitly prohibit automated access/reproduction of their depth charts
// (see project memory: project_ourlads_scraping_legal_risk). An adapter
// backed by a licensed/authorized source can be dropped in at the path below
// without touching this file again; must implement `fetchRosterHTML(): Promise<string>`
// returning HTML in the same shape parseHTMLToRoster() already parses.
// import.meta.glob() requires a literal string argument — Vite parses it
// statically at build time, not at runtime — so the path can't be shared
// via a variable and has to be repeated (matches the ESPNProvider pattern).
export function hasRosterSourceAdapter() {
    const modules = import.meta.glob('../services/RosterSourceAdapter.js');
    return Object.keys(modules).length > 0;
}

export async function fetchAdapterRoster() {
    const modules = import.meta.glob('../services/RosterSourceAdapter.js');
    const modulePath = '../services/RosterSourceAdapter.js';
    if (!modules[modulePath]) {
        throw new Error('No roster source adapter configured');
    }
    const mod = await modules[modulePath]();
    const adapter = new mod.RosterSourceAdapter();
    const html = await adapter.fetchRosterHTML();
    if (!html) throw new Error('Adapter returned no data');
    return parseHTMLToRoster(html);
}

export async function fetchLocalRoster() {
    const res = await fetch(`${import.meta.env.BASE_URL}roster.csv`);
    if (!res.ok) throw new Error("Could not find local roster.csv");
    const text = await res.text();
    return parseCSV(text);
}
