/**
 * Roster state management + CSV import/export.
 * Stored in localStorage under key 'rosterState'.
 */
import { parseCsvLine, csvField } from './csvUtils';
import { parseAcquisition } from './draftPhase';
import { DRAFT_YEAR } from '../constants';
import { resolve as resolvePlayer, setFacts } from './playerRegistry';

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
/**
 * A depth-chart slot.
 *
 * `name` is the plain player name — the identity everything else matches on.
 * `arrival` is how he got to this team ("24/1", "FA", "UDFA"), which the
 * import file writes into the name and this splits back out. It is kept on the
 * slot rather than on the player because it describes a roster, not a person:
 * the same player arrives at different clubs by different routes.
 */
export function makeSlot(name, zone = '53', arrival = null) {
    if (!name) return null;
    return arrival ? { name, zone, arrival } : { name, zone };
}

/**
 * Splits an imported cell into a slot, recording what the suffix says about
 * the player on his registry record along the way. The file keeps its format;
 * the app stores a plain name and a tag.
 */
function slotFromImport(raw, zone) {
    const { name, facts } = parseAcquisition(raw, DRAFT_YEAR);
    if (!name) return null;
    const arrival = String(raw ?? '').trim().slice(name.length + 1).trim() || null;

    if (Object.keys(facts).length) {
        const id = resolvePlayer({ name });
        if (id) setFacts(id, facts);
    }
    return makeSlot(name, zone, arrival);
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
/**
 * Stored shape version. Bump when the persisted shape changes in a way older
 * data can't satisfy, and add a step to `migrate` — without this there was no
 * way to tell an old shape from a current one, so a stale blob was simply
 * trusted and rendered wrong.
 *
 * Version 1 is the shape that already existed; unversioned data is treated as
 * version 1 rather than discarded, since that is exactly what it is.
 */
export const STATE_VERSION = 1;

function migrate(parsed) {
    const from = typeof parsed.version === 'number' ? parsed.version : 1;
    if (from > STATE_VERSION) return null; // written by a newer app — don't guess
    // (no migration steps yet; add them here as the shape changes)
    return { ...parsed, version: STATE_VERSION };
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.positionConfig?.offense?.length > 0) return migrate(parsed);
        }
    } catch { /* ignore */ }
    return null;
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
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
            const names = rawSlots.map(s => s.trim()).filter(Boolean)
                .map(n => slotFromImport(n.replace(/^(PS:|IR:|R:)/i, '').trim(), '53')?.name)
                .filter(Boolean);
            reserve.push(...names);
            continue;
        }
        if (phase === 'CUT' || phase === 'CUTS') {
            const col2 = cols[2]?.trim() ?? '';
            const parsedSlots = parseInt(col2);
            const hasSlots53Col = !isNaN(parsedSlots);
            const rawSlots = hasSlots53Col ? cols.slice(3) : cols.slice(2);
            const names = rawSlots.map(s => s.trim()).filter(Boolean)
                .map(n => slotFromImport(n.replace(/^(PS:|IR:|R:)/i, '').trim(), '53')?.name)
                .filter(Boolean);
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

            const slot = slotFromImport(v.replace(/^(PS:|IR:|R:)/i, '').trim(), zone);
            if (!slot) return;

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

// The import format joins the arrival tag back onto the name, so a round trip
// through the file is lossless.
function exportName(slot) {
    return slot.arrival ? `${slot.name}:${slot.arrival}` : slot.name;
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
                if (s.zone === 'ps') return `PS:${exportName(s)}`;
                if (s.zone === 'ir') return `IR:${exportName(s)}`;
                if (s.zone === 'r') return `R:${exportName(s)}`;
                return exportName(s);
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

// Ourlads' IR/PUP table has a different shape from the other four: the row
// label is a status ("IR"/"PUP"), not a position, and each player's own
// position is instead appended as a trailing code in the name cell itself
// (e.g. "Holiday, Jimmy WR", "Norman-Lott, Omarr DT^") — cleanPlayerNameWithStatus's
// suffix-stripping regexes only match digit-bearing draft-status tokens, so
// reusing it here would leave the position stuck between first and last name
// ("Jimmy WR Holiday"). Strip it first, then apply the same Last, First swap.
function cleanIRPlayerName(el) {
    if (!el) return null;
    let raw = el.textContent.trim();
    if (!raw) return null;
    raw = raw.replace(/\s+[A-Z]{1,3}\^?$/, '').trim();
    if (raw.includes(',')) {
        const [last, ...rest] = raw.split(',');
        const first = rest.join(',').trim();
        if (first) return `${first} ${last.trim()}`;
    }
    return raw;
}

export function parseHTMLToRoster(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allTables = Array.from(doc.querySelectorAll('table.table-bordered'));
    // Offense, Defense, Specialists, Practice Squad, IR/PUP — in that order
    // on Ourlads' depth chart pages. Only the first 3 were parsed previously;
    // PS/IR data had to be entered by hand as a result (see project memory:
    // this was a known scraper coverage gap, not a design choice).
    const tables = allTables.filter(t => t.rows[0]?.cells.length >= 3).slice(0, 5);
    const [psTable, irTable] = [tables[3], tables[4]];

    // Use an accumulator to merge positions
    const mergedData = { O: {}, D: {}, S: {} };

    tables.slice(0, 3).forEach((table, tableIdx) => {
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

    // Practice Squad — one player per generic position code, resolved against
    // the specific starter rows just built (e.g. a bare "WR" entry can land
    // in WR.Z/WR.X/WR.S; resolvePosition prefers whichever sibling row has
    // the fewest players so far, so repeated generic codes spread across
    // siblings rather than piling onto one). Ourlads' PS table uses a few
    // codes ("OT", "OG", "ED") that don't correspond to any specific starter
    // label at all — those get their own new row rather than being silently
    // dropped, which is what happened before this table was parsed at all.
    if (psTable) {
        const rows = Array.from(psTable.querySelectorAll('tr')).slice(1);
        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 3) return;
            const rawPos = cells[0].textContent.trim();
            if (!rawPos) return;
            const playerLink = cells[2]?.querySelector('a');
            const name = cleanPlayerNameWithStatus(playerLink || cells[2]);
            if (!name) return;

            let rowId = resolvePosition(rawPos, { offense, defense }, depthChart);
            if (!rowId) {
                const isDefense = ['ED', 'DT', 'DE', 'LB', 'CB', 'S', 'NT'].includes(rawPos);
                rowId = `${isDefense ? 'D' : 'O'}-${rawPos}-0`; // matches parseCSV's own `${phase}-${pos}-0` id convention
                if (!depthChart[rowId]) {
                    (isDefense ? defense : offense).push({ id: rowId, label: rawPos, slots53: slots53ForPos(rawPos) });
                    depthChart[rowId] = [];
                }
            }

            const limit53 = [...offense, ...defense].find(p => p.id === rowId)?.slots53 ?? 2;
            const arr = depthChart[rowId] = depthChart[rowId] ?? [];
            const psCount = arr.filter(s => s?.zone === 'ps').length;
            arr[limit53 + psCount] = makeSlot(name, 'ps');
        });
    }

    // IR/PUP — flat name list, no position tracking, matching the app's
    // existing IR model (state.reserve is just player names, see performMove
    // in RosterView.jsx). Row label here is a status ("IR"/"PUP"), not a
    // position, so unlike every other table there's nothing to resolve.
    const reserve = [];
    if (irTable) {
        const rows = Array.from(irTable.querySelectorAll('tr')).slice(1);
        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            for (let i = 2; i < cells.length; i += 2) {
                const playerLink = cells[i].querySelector('a');
                const name = cleanIRPlayerName(playerLink || cells[i]);
                if (name) reserve.push(name);
            }
        });
    }

    return { positionConfig: { offense, defense }, depthChart, reserve, cuts: [] };
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

/**
 * Last season's position structure with every slot emptied — the depth chart
 * you start an offseason with before anyone is signed or drafted into it.
 *
 * defaultState() has no position rows at all, so a roster built from it has
 * nowhere to put anybody: "Sync from FA/Draft/UDFA" resolves each player to a
 * row, finds none, and silently places nothing. Starting from the real shape
 * means the pipeline (free agency + draft picks + UDFA signings -> the 53)
 * actually has somewhere to land.
 */
export async function fetchSeasonStartStructure() {
    const res = await fetch(`${import.meta.env.BASE_URL}roster_2025_end.csv`);
    if (!res.ok) throw new Error(`Could not load last season's roster (HTTP ${res.status})`);
    const parsed = parseCSV(await res.text());
    const depthChart = {};
    Object.keys(parsed.depthChart).forEach(id => { depthChart[id] = []; });
    return { ...parsed, depthChart, reserve: [], cuts: [] };
}

export async function fetchLocalRoster() {
    const res = await fetch(`${import.meta.env.BASE_URL}roster.csv`);
    if (!res.ok) throw new Error("Could not find local roster.csv");
    const text = await res.text();
    return parseCSV(text);
}
