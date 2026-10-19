/**
 * What a man plays, versus where he lines up.
 *
 * Three vocabularies describe the same football, and nothing until now
 * translated between them:
 *
 *   rankings files   EDGE, IOL, OT, DL.1T, CB      — what he PLAYS
 *   the picks file   DE, OG, G, DT, OLB, Edge      — whatever the source said
 *   the depth chart  LDE, RDE, LG, C, RG, DT.1T    — where he STANDS
 *
 * The cost of that gap, all from one missing table:
 *
 *   - the registry minted a second record for one man whenever two sources
 *     labelled him differently — seven of the twelve duplicates found were
 *     an alignment against a position (LDE|RDE, EDGE|LDE, OG|LG, DT|NT);
 *   - the roster sync reports "no matching position row" for an OT when the
 *     chart offers LT and RT, because `resolvePosition` compares labels;
 *   - DL.1T does not reach the DT.1T row, for the same reason.
 *
 * TWO RELATIONS, and the difference is load-bearing.
 *
 * CONTAINMENT is a position and the rows it covers. It is a fact about
 * football: a left defensive end IS an edge rusher. It NORMALISES a label, so
 * it is safe for identity — LDE and EDGE are one man written two ways.
 *
 * COMPATIBILITY is two DIFFERENT positions that can fill each other's rows. A
 * tackle can play guard. It must NEVER be used for identity: collapsing OT and
 * IOL would merge two men who happen to share a name, one a tackle and one a
 * guard, which is the exact failure the registry exists to prevent.
 *
 *   identity  -> containment only
 *   placement -> containment + compatibility
 */

/** Player position -> the depth-chart rows it covers. */
export const COVERS = {
    QB: ['QB'],
    RB: ['RB'],
    FB: ['RB'],
    WR: ['WR.X', 'WR.Z', 'WR.S'],
    'WR.S': ['WR.S'],
    TE: ['TE'],
    OT: ['LT', 'RT'],
    IOL: ['LG', 'C', 'RG'],
    'IOL.G': ['LG', 'RG'],
    'IOL.C': ['C'],
    EDGE: ['LDE', 'RDE'],
    DL: ['DT.1T', 'DT.3T'],
    'DL.1T': ['DT.1T'],
    'DL.3T': ['DT.3T'],
    'DL.5T': ['LDE', 'RDE'],
    LB: ['LB.W', 'LB.M', 'LB.S'],
    'LB.I': ['LB.M'],
    'LB.O': ['LB.W', 'LB.S'],
    CB: ['CB.L', 'CB.R', 'CB.N'],
    'CB.N': ['CB.N'],
    S: ['S.S', 'S.F'],
    P: ['P'],
    K: ['K'],
    LS: ['LS'],
};

/**
 * Labels other sources use for a position this app names differently.
 *
 * Only unambiguous ones. `DB`, `OL` and `WR/TE` are deliberately absent: they
 * name a group rather than a position, and guessing which half is meant is how
 * a wrong record gets written confidently.
 */
export const ALIASES = {
    DE: 'EDGE',
    DT: 'DL',
    NT: 'DL.1T',
    OG: 'IOL.G',
    G: 'IOL.G',
    OC: 'IOL.C',
    // OLB means an edge rusher in a 3-4 and an off-ball linebacker in a 4-3.
    // Containment has to be a function — one label, one position — or
    // samePosition becomes incoherent, so it resolves to the linebacker family
    // and the EDGE <-> LB pair below carries the 3-4 case for placement.
    OLB: 'LB.O',
    LOLB: 'LB.O',
    ROLB: 'LB.O',
    ILB: 'LB.I',
    MLB: 'LB.I',
    FS: 'S',
    SS: 'S',
};

/**
 * Positions that can fill each other's rows. Symmetric, and deliberately
 * small: every pair here is a scheme opinion the expert owns, not a fact, so
 * it starts at what has actually been asked for and grows by editing rather
 * than by guessing.
 */
export const DEFAULT_COMPATIBLE = [
    ['OT', 'IOL'],     // a tackle kicking inside to guard
    ['EDGE', 'DL'],    // five-technique and interior rusher are one body
    ['CB', 'S'],       // the nickel, filed either way by different sources
    ['EDGE', 'LB'],    // the 3-4 outside linebacker, and the EDGE|LB duplicate
    ['TE', 'FB'],
];

// Pairs, deliberately NOT a graph: EDGE reaches DL and EDGE reaches LB, but a
// linebacker never reaches an interior line row. "LB can't play DT and vice
// versa" — closing this transitively would put one there.

// A row maps back to the NARROWEST position that covers it: DT.1T is a
// 1-tech before it is interior defensive line. Taking the first writer instead
// made DT.1T read as plain DL, and a player labelled DL.1T then failed to match
// his own row.
/**
 * Labels that name a GROUP rather than a position.
 *
 * `OL` does not say tackle or guard; `DB` does not say corner or safety. They
 * carry real information — just not enough to name one position — so they get
 * a third relation of their own.
 *
 * PLACEMENT ONLY, and in one direction. A group reaches every member's rows,
 * and `resolvePosition` already prefers the emptiest, so an OL lands wherever
 * there is most space. It is NOT used the other way: reading a man out of the
 * LG row still says IOL, never "some offensive lineman". And it never touches
 * identity — a group cannot be canonicalised to one of its members without
 * guessing which.
 */
export const DEFAULT_GROUPS = {
    OL: ['OT', 'IOL'],
    DB: ['CB', 'S'],
    'WR/TE': ['WR', 'TE'],
};

// ---------------------------------------------------------------------------
// The editable half
//
// Containment is not here. It is what identity compares through, so an edit
// that stops two labels matching starts minting duplicate records — the one
// table where being wrong is expensive. Compatibility and groups only ever
// widen where somebody MAY be placed, and the worst case is a near-fit in a
// slot you would rather have left empty, which is visible and reversible.
// ---------------------------------------------------------------------------

const COMPATIBLE_KEY = 'position_compatible_v1';
const GROUPS_KEY = 'position_groups_v1';

let compatibleCache = null;
let groupsCache = null;

const up = (x) => String(x ?? '').trim().toUpperCase();

/** Pairs, as `OT/IOL, EDGE/DL`. Anything empty resets to the shipped set. */
export function getCompatible() {
    if (compatibleCache) return compatibleCache;
    try {
        const stored = JSON.parse(localStorage.getItem(COMPATIBLE_KEY) || 'null');
        if (Array.isArray(stored) && stored.length) {
            compatibleCache = stored
                .map(pair => (Array.isArray(pair) ? pair.map(up) : []))
                .filter(pair => pair.length === 2 && pair[0] && pair[1]);
            if (compatibleCache.length) return compatibleCache;
        }
    } catch { /* ignore */ }
    compatibleCache = DEFAULT_COMPATIBLE;
    return compatibleCache;
}

export function setCompatible(value) {
    const pairs = (Array.isArray(value) ? value : parsePairs(value))
        .map(pair => pair.map(up)).filter(pair => pair.length === 2 && pair[0] && pair[1]);
    compatibleCache = null;
    try {
        if (!pairs.length) localStorage.removeItem(COMPATIBLE_KEY);
        else localStorage.setItem(COMPATIBLE_KEY, JSON.stringify(pairs));
    } catch { /* ignore */ }
    return getCompatible();
}

/** `OL = OT + IOL, DB = CB + S`. */
export function getGroups() {
    if (groupsCache) return groupsCache;
    try {
        const stored = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null');
        if (stored && typeof stored === 'object' && Object.keys(stored).length) {
            groupsCache = Object.fromEntries(Object.entries(stored)
                .map(([k, v]) => [up(k), (Array.isArray(v) ? v : []).map(up).filter(Boolean)])
                .filter(([k, v]) => k && v.length));
            if (Object.keys(groupsCache).length) return groupsCache;
        }
    } catch { /* ignore */ }
    groupsCache = DEFAULT_GROUPS;
    return groupsCache;
}

export function setGroups(value) {
    const table = (value && typeof value === 'object' && !Array.isArray(value)) ? value : parseGroups(value);
    const clean = Object.fromEntries(Object.entries(table)
        .map(([k, v]) => [up(k), (Array.isArray(v) ? v : []).map(up).filter(Boolean)])
        .filter(([k, v]) => k && v.length));
    groupsCache = null;
    try {
        if (!Object.keys(clean).length) localStorage.removeItem(GROUPS_KEY);
        else localStorage.setItem(GROUPS_KEY, JSON.stringify(clean));
    } catch { /* ignore */ }
    return getGroups();
}

/** `OT/IOL, EDGE/DL` -> [['OT','IOL'], ['EDGE','DL']] */
export function parsePairs(text) {
    return String(text ?? '').split(',')
        .map(chunk => chunk.split('/').map(x => x.trim()).filter(Boolean))
        .filter(pair => pair.length === 2);
}

/** `OL = OT + IOL, DB = CB + S` -> { OL: ['OT','IOL'], DB: ['CB','S'] } */
export function parseGroups(text) {
    const out = {};
    String(text ?? '').split(/[,\n]/).forEach((line) => {
        const [name, members] = line.split('=');
        if (!name || !members) return;
        const list = members.split('+').map(x => x.trim()).filter(Boolean);
        if (list.length) out[name.trim()] = list;
    });
    return out;
}

/** For the settings field, and for showing what is in force. */
export const formatPairs = (pairs) => pairs.map(p => p.join('/')).join(', ');
export const formatGroups = (groups) => Object.entries(groups)
    .map(([k, v]) => `${k} = ${v.join(' + ')}`).join(', ');

const ROW_TO_POSITION = (() => {
    const m = new Map();
    Object.entries(COVERS).forEach(([position, rows]) => {
        rows.forEach((row) => {
            const held = m.get(row);
            if (!held || rows.length < (COVERS[held] ?? []).length) m.set(row, position);
        });
    });
    return m;
})();

const clean = (label) => String(label ?? '').trim().toUpperCase();

/**
 * The player position a label denotes, whatever vocabulary it came from.
 * Returns '' for anything unrecognised — including URA, which is not a
 * position at all — so an unknown label never discriminates.
 */
export function canonicalPosition(label) {
    const raw = clean(label);
    if (!raw || raw === 'URA') return '';
    if (COVERS[raw]) return raw;
    if (ALIASES[raw]) return ALIASES[raw];
    // A row id: give back the position that covers it.
    if (ROW_TO_POSITION.has(raw)) return ROW_TO_POSITION.get(raw);
    // A sub-type nobody declared (DL.7T): fall back to its major, which is how
    // this app has always read a dotted label.
    const major = raw.split('.', 1)[0];
    if (COVERS[major]) return major;
    if (ALIASES[major]) return ALIASES[major];
    return raw;
}

/**
 * Do two labels denote the same position? Containment only — never
 * compatibility. An unknown on either side is not evidence of a difference,
 * which is the rule the name matcher already follows.
 */
export function samePosition(a, b) {
    const x = canonicalPosition(a);
    const y = canonicalPosition(b);
    if (!x || !y) return true;
    if (x === y) return true;

    // A sub-type is the same man described more precisely: a nose tackle IS a
    // defensive tackle, which is the Seumalo duplicate. So DL matches DL.1T,
    // while DL.1T and DL.3T stay apart — both sides declared a sub-type and
    // they differ, which is the only case where the sub-type is evidence.
    const [xMajor, xSub] = x.split('.');
    const [yMajor, ySub] = y.split('.');
    if (xMajor !== yMajor) return false;
    return !xSub || !ySub;
}

/** Every row `label` may fill: its own, plus those of compatible positions. */
export function rowsFor(label) {
    const position = canonicalPosition(label);
    if (!position) return [];

    // A group reaches every member's rows. The caller picks among them by
    // space, which is the whole point of not forcing a choice here.
    const group = getGroups()[position];
    if (group) {
        const rows = new Set();
        group.forEach(member => rowsFor(member).forEach(r => rows.add(r)));
        return [...rows];
    }
    const out = new Set(COVERS[position] ?? []);

    // A sub-type inherits its family's pairs: LB.O is a linebacker, so an OLB
    // reaches the edge rows the EDGE <-> LB pair opens up. Matching only the
    // exact string left "OLB" with nothing but LB.W and LB.S.
    const major = position.split('.', 1)[0];
    const isMine = (label) => label === position || label === major;
    getCompatible().forEach(([a, b]) => {
        if (isMine(a)) (COVERS[b] ?? []).forEach(r => out.add(r));
        if (isMine(b)) (COVERS[a] ?? []).forEach(r => out.add(r));
    });
    return [...out];
}
