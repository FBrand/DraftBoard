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
    LB: ['LB.W', 'LB.M'],
    'LB.I': ['LB.M'],
    'LB.O': ['LB.W'],
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
    OLB: 'LB.O',
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
export const COMPATIBLE = [
    ['OT', 'IOL'],
];

// A row maps back to the NARROWEST position that covers it: DT.1T is a
// 1-tech before it is interior defensive line. Taking the first writer instead
// made DT.1T read as plain DL, and a player labelled DL.1T then failed to match
// his own row.
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
    const out = new Set(COVERS[position] ?? []);
    COMPATIBLE.forEach(([a, b]) => {
        if (a === position) (COVERS[b] ?? []).forEach(r => out.add(r));
        if (b === position) (COVERS[a] ?? []).forEach(r => out.add(r));
    });
    return [...out];
}
