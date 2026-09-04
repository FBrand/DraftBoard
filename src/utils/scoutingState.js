/**
 * Scouting board state — tags/rank/notes an analyst assigns while BUILDING
 * a board, not a personal opinion layered on top of one fixed consensus
 * board. Kept per-board (Consensus/Dan/Ryan — the same three identities the
 * Draft/UDFA board-switcher already uses) so each analyst's evaluations are
 * independent: switching board in ScoutingView switches which analyst's
 * ranking/notes you're viewing or building for the same player, entirely
 * separate from the `players` list's own overallRank/group (that's the
 * rankings CSV currently loaded, joined by name at render time — see
 * nameMatcher.js — so reloading it never touches or invalidates these).
 */
import { parseCsvLine, csvField } from './csvUtils';

export const BOARDS = ['consensus', 'dan', 'ryan'];
export const BOARD_LABELS = { consensus: 'Consensus', dan: 'Dan', ryan: 'Ryan' };

const storageKey = (board) => `scouting_overlay_v1__${board}`;

export function makeEntry(name, position) {
    return {
        name, position, tag: null,
        // group mirrors rankings.csv's own `group` column (e.g. "1.3" —
        // round 1, tier 3; CenterBoard reads the leading digits as the
        // round and treats the whole string as the tier-row key) so an
        // exported board slots straight into the app via exportRankingsCSV.
        group: null,
        personalRank: null, positionRank: null,
        athleticMatrixTotal: null, athleticMatrixPosition: null,
        strengths: [], weaknesses: [], notes: [],
        updatedAt: new Date().toISOString(),
    };
}

function toIntOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
}

// Bullet-list fields are JSON-encoded within their CSV field rather than
// joined on a delimiter (e.g. '|') — parseCSV splits the whole file on '\n'
// before parseCsvLine ever sees a line, so a literal separator inside one
// bullet couldn't be told apart from the list's own boundary. csvField's
// RFC-4180 quoting already escapes whatever the JSON string contains
// (commas, quotes), so this rides the existing quoting for free.
function parseListField(raw) {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
        return [];
    }
}

export function loadState(board) {
    try {
        const raw = localStorage.getItem(storageKey(board));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed;
        }
    } catch { /* ignore */ }
    return { version: 1, entries: [] };
}

export function saveState(board, state) {
    localStorage.setItem(storageKey(board), JSON.stringify(state));
}

export function parseCSV(csvText) {
    const lines = csvText
        .trim()
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.toLowerCase().startsWith('#') && !l.toLowerCase().startsWith('name,'));

    const entries = lines.map(line => {
        const [
            name, position, group, tag, personalRank, positionRank,
            athleticMatrixTotal, athleticMatrixPosition,
            strengths, weaknesses, notes, updatedAt,
        ] = parseCsvLine(line);
        return {
            name: (name ?? '').trim(),
            position: (position ?? '').trim(),
            group: group && group.trim() ? group.trim() : null,
            tag: tag && tag.trim() ? tag.trim() : null,
            personalRank: toIntOrNull(personalRank),
            positionRank: toIntOrNull(positionRank),
            athleticMatrixTotal: toIntOrNull(athleticMatrixTotal),
            athleticMatrixPosition: toIntOrNull(athleticMatrixPosition),
            strengths: parseListField(strengths),
            weaknesses: parseListField(weaknesses),
            notes: parseListField(notes),
            updatedAt: updatedAt && updatedAt.trim() ? updatedAt.trim() : new Date().toISOString(),
        };
    }).filter(e => e.name);

    return { version: 1, entries };
}

export function exportCSV(state) {
    const rows = [
        '# Scouting Overlay Export',
        `# Exported: ${new Date().toISOString()}`,
        [
            'name', 'position', 'group', 'tag', 'personalRank', 'positionRank',
            'athleticMatrixTotal', 'athleticMatrixPosition',
            'strengths', 'weaknesses', 'notes', 'updatedAt',
        ].map(csvField).join(','),
    ];
    state.entries.forEach(e => {
        rows.push([
            e.name, e.position, e.group ?? '', e.tag ?? '', e.personalRank ?? '', e.positionRank ?? '',
            e.athleticMatrixTotal ?? '', e.athleticMatrixPosition ?? '',
            JSON.stringify(e.strengths ?? []), JSON.stringify(e.weaknesses ?? []), JSON.stringify(e.notes ?? []),
            e.updatedAt,
        ].map(csvField).join(','));
    });
    return rows.join('\n');
}

// Board-ready export: just group,name,position — the exact shape
// rankings.csv/rankings_dan.csv/etc. use (see CLAUDE.md), so a board built
// in Scouting can be dropped straight into `public/` or loaded via
// `?rankings=`. Sorted by personalRank (the drag-order from
// ScoutingLeftPanel) since that's this board's actual pick order; entries
// without a group fall back to an empty group cell, which rankings.csv
// itself treats as "inherit the previous row's group".
export function exportRankingsCSV(state) {
    const rows = ['group,name,position'];
    [...state.entries]
        .filter(e => e.name)
        .sort((a, b) => (a.personalRank ?? Infinity) - (b.personalRank ?? Infinity))
        .forEach(e => {
            rows.push([e.group ?? '', e.name, e.position].map(csvField).join(','));
        });
    return rows.join('\n');
}
