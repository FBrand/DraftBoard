/**
 * Shared RFC-4180-style CSV quoting helpers. Extracted from rosterState.js
 * (where they were first added to fix player names containing a literal
 * comma — Ourlads' own "Last, First" convention — silently corrupting on
 * export/re-import) once a second consumer (scoutingState.js) needed the
 * same behavior.
 */

// A plain `line.split(',')` corrupts any field containing a literal comma.
// Handles quoted fields and doubled-quote escaping; doesn't handle a quoted
// field spanning multiple physical lines, since callers split on '\n' first.
export function parseCsvLine(line) {
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

// Counterpart to parseCsvLine: quote any field containing a comma, quote
// character, or newline (RFC 4180 style), doubling embedded quotes.
export function csvField(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
