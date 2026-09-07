/**
 * A board as a spreadsheet.
 *
 * One row per player, one board per file. The board is NOT a column: the file
 * is a ranking, and which board it lands on is chosen when it is imported.
 * Putting it in the data would mean a file that silently writes somewhere you
 * didn't mean.
 *
 *   round,tier,name,position,school,tag,evaluation
 *
 * Remarks fold into the evaluation cell rather than living in a file of their
 * own, one per line, each carrying the marker that says what kind it is —
 * which is how an analyst writes them anyway, and readable in the cell without
 * decoding anything. The previous format put a JSON array in the cell, which
 * no non-technical user can type and which Sheets mangles on save.
 *
 *   Remarks:
 *   + Elite arm talent
 *   - Footwork under pressure
 *   • Two-year starter
 *
 * The "Remarks:" line is load-bearing, not decoration. Sheets and Excel treat
 * a cell beginning with + or - as a formula, so a cell that opened with
 * "+ Elite arm talent" would error the moment somebody typed it by hand.
 */
import { parseCsvLine, csvField } from './csvUtils';
import { tagById, PLAYER_TAGS } from './playerTags';

// THE board format — one file in, one file out. Matches prospects.CSV_COLUMNS
// (what "+ Add Players" imports and its template hands you) and dataParser
// reads it, so a board exported here can be dropped straight into public/ or
// loaded with ?rankings=. There is no separate seed format any more: it was a
// strict subset of this one carrying the same data in fewer columns.
export const BOARD_CSV_COLUMNS = [
    'name', 'position', 'school', 'tag', 'round', 'tier', 'rank',
    'matrixTotal', 'matrixPosition', 'evaluation',
];

const REMARKS_PREFIX = 'Remarks:';

// A hyphen is what somebody actually types; the minus and en-dash are what a
// word processor or this app produces. All three mean the same thing, and a
// remark should not be silently reclassified because of which one arrived.
const MARKERS = [
    { kind: 'strength', chars: ['+'] },
    { kind: 'weakness', chars: ['-', '−', '–', '—'] },
    { kind: 'note', chars: ['•', '*', '.', 'o'] },
];

const MARKER_OUT = { strength: '+', weakness: '-', note: '•' };

const kindForMarker = (ch) => MARKERS.find(m => m.chars.includes(ch))?.kind ?? null;

/** Turns remarks into one cell. Empty when there are none — not "Remarks:". */
export function formatRemarksCell(remarks) {
    const lines = (remarks ?? [])
        .filter(r => r?.text)
        .map(r => `${MARKER_OUT[r.kind] ?? MARKER_OUT.note} ${r.text}`);
    return lines.length ? [REMARKS_PREFIX, ...lines].join('\n') : '';
}

/**
 * Reads a cell back. Liberal on purpose: the header line is optional, markers
 * may be any of their spellings, and a line with no marker at all is taken as
 * a note rather than dropped — somebody typing quickly should not lose what
 * they wrote.
 */
export function parseRemarksCell(cell) {
    const text = String(cell ?? '').trim();
    if (!text) return [];

    return text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => l.toLowerCase() !== REMARKS_PREFIX.toLowerCase())
        .map(line => {
            const kind = kindForMarker(line[0]);
            if (kind) {
                const body = line.slice(1).trim();
                return body ? { kind, text: body } : null;
            }
            // No marker — keep it as a note rather than discard it.
            return { kind: 'note', text: line };
        })
        .filter(Boolean);
}

const tagSymbol = (id) => tagById(id)?.symbol ?? '';

export const tagFromCell = (cell) => {
    const v = String(cell ?? '').trim();
    if (!v) return null;
    const bySymbol = PLAYER_TAGS.find(t => t.symbol === v);
    if (bySymbol) return bySymbol.id;
    const byName = PLAYER_TAGS.find(t => t.id === v.toLowerCase() || t.label.toLowerCase() === v.toLowerCase());
    return byName?.id ?? null;
};

/**
 * One board, in rank order. `remarksFor(player)` supplies that board's voice;
 * pass nothing to export placement only.
 */
/**
 * One board, in rank order. `entryFor(player)` supplies that board's tag and
 * placement, `remarksFor(player)` its voice; pass neither to export the pool
 * alone.
 */
export function exportBoardCSV(players, { entryFor, remarksFor, matrixFor } = {}) {
    const rows = [BOARD_CSV_COLUMNS.join(',')];

    (players ?? []).filter(p => p?.name).forEach(p => {
        const entry = entryFor?.(p) ?? null;
        // Matrix scores are facts on the player's record, not on the pool
        // object the board renders, so the caller supplies them.
        const matrix = matrixFor?.(p) ?? {};
        rows.push([
            p.name,
            p.position ?? '',
            p.school ?? '',
            tagSymbol(entry?.tag ?? null),
            p.round ?? '',
            p.tier ?? '',
            // Position within the tier — the stored ordering, not the derived
            // total rank, which is counted off the board and would be a lie in
            // a file that can be reordered by hand.
            entry?.withinGroup ?? '',
            matrix.total ?? p.athleticMatrixTotal ?? '',
            matrix.position ?? p.athleticMatrixPosition ?? '',
            formatRemarksCell(remarksFor?.(p) ?? []),
        ].map(csvField).join(','));
    });

    return rows.join('\n');
}

const num = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
};

/**
 * Reads a board file. Column order is taken from the header when there is one,
 * so a spreadsheet that reorders columns still imports; without a header the
 * documented order is assumed.
 */
export function parseBoardCSV(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    // A quoted cell may span lines, so the file is re-joined and split by the
    // CSV parser rather than by newline alone.
    const records = splitRecords(lines);
    if (!records.length) return [];

    const first = parseCsvLine(records[0]).map(h => h.trim().toLowerCase());
    const hasHeader = first.includes('name');
    const columns = hasHeader ? first : BOARD_CSV_COLUMNS;
    const body = hasHeader ? records.slice(1) : records;

    return body.map(record => {
        const cells = parseCsvLine(record);
        const row = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));
        if (!String(row.name ?? '').trim()) return null;
        return {
            round: num(row.round),
            tier: num(row.tier),
            name: String(row.name).trim(),
            position: String(row.position ?? '').trim().toUpperCase(),
            school: String(row.school ?? '').trim(),
            tag: tagFromCell(row.tag),
            remarks: parseRemarksCell(row.evaluation),
        };
    }).filter(Boolean);
}

/** Rejoins lines that belong to one record, because a cell may contain them. */
export function splitRecords(lines) {
    const records = [];
    let current = '';
    let open = false;

    lines.forEach(line => {
        const quotes = (line.match(/"/g) || []).length;
        current = current ? `${current}\n${line}` : line;
        if (quotes % 2 === 1) open = !open;
        if (!open) {
            if (current.trim()) records.push(current);
            current = '';
        }
    });
    if (current.trim()) records.push(current);
    return records;
}
