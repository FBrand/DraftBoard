import { parseTier } from './boardRanking';
import { parseCsvLine } from './csvUtils';
import { splitRecords, parseRemarksCell, tagFromCell } from './boardCsv';

/**
 * Reads a rankings file.
 *
 * There is ONE board format now. It used to be three, which all carried the
 * same data in different shapes: a `group,name,position` seed file, a full
 * internal export written for the machine, and a human-readable one. A file is
 * a file — so this reads the full column set, and the old three-column files
 * in public/ keep working because their columns are a subset of it.
 *
 *   name, position, school, tag, round, tier, rank,
 *   matrixTotal, matrixPosition, evaluation
 *
 * Two things are read leniently because both spellings exist in the wild:
 *
 *   `group` is the fused "1.3" form of round and tier. The shipped files use
 *   it, and a blank one INHERITS the last seen value — that is what makes a
 *   hand-typed file bearable, since a tier is written once and applies until
 *   it changes. `round` and `tier` as separate columns win when present.
 *
 *   A favourite is `*` in the old `favourite` column and a `like` tag in the
 *   new one. They mean the same thing and always did.
 *
 * A file with no header at all is read positionally as the legacy
 * `group,name,position,favourite`, which is what every file in public/ was
 * before this and what somebody may still paste in.
 */
const LEGACY_COLUMNS = ['group', 'name', 'position', 'favourite'];

const cell = (row, key) => String(row[key] ?? '').trim();
const num = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
};

export const parseRankings = (csvText) => {
    const records = splitRecords(String(csvText ?? '').trim().split(/\r?\n/))
        .filter(r => r.trim() && !r.trim().startsWith('#'));
    if (!records.length) return [];

    const first = parseCsvLine(records[0]).map(h => h.trim().toLowerCase());
    const hasHeader = first.includes('name') || first.includes('group');
    const columns = hasHeader ? first : LEGACY_COLUMNS;
    const body = hasHeader ? records.slice(1) : records;

    let currentGroup = '';
    return body.map((record, index) => {
        const cells = parseCsvLine(record);
        const row = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));

        const name = cell(row, 'name');
        if (!name) return null;

        // A blank group inherits the last one seen; explicit round/tier win.
        const group = cell(row, 'group');
        if (group) currentGroup = group;
        const explicit = { round: num(row.round), tier: num(row.tier) };
        const placement = explicit.round != null ? explicit : parseTier(currentGroup);

        // The tag column takes either the symbol or the word — the export
        // writes "★" and a person types "like".
        const tag = tagFromCell(row.tag);
        return {
            name,
            position: cell(row, 'position'),
            school: cell(row, 'school'),
            ...placement,
            tag: tag || null,
            withinGroup: num(row.rank),
            athleticMatrixTotal: num(row.matrixtotal),
            athleticMatrixPosition: num(row.matrixposition),
            remarks: parseRemarksCell(row.evaluation),
            // The star and the `like` tag are one mechanic, not two.
            isFavorite: cell(row, 'favourite') === '*' || tag === 'like',
            overallRank: index + 1,
            drafted: false,
            draftedByUs: false,
        };
    }).filter(Boolean);
};

export const parsePicks = (picksText) => {
  return picksText
    .split(',')
    .map(p => parseInt(p.trim(), 10))
    // Same rule as the session file: picks count from one, so a 0 is either
    // a typo or an empty list that went through join(",").
    .filter(p => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
};
