/**
 * Scouting board state — tags/rank/notes an analyst assigns while BUILDING
 * a board, not a personal opinion layered on top of one fixed consensus
 * board. Kept per-board (Consensus/Dan/Ryan — the same three identities the
 * Draft/UDFA board-switcher already uses) so each analyst's evaluations are
 * independent: switching board in ScoutingView switches which analyst's
 * ranking/notes you're viewing or building for the same player. Entries are
 * joined to the loaded rankings by name at render time (see nameMatcher.js),
 * so reloading the rankings CSV never invalidates them.
 *
 * `group` and `withinGroup` are OVERRIDES of the board's own parameters, not
 * separate fields that merely sit beside them. Everything downstream — card
 * placement on the grid, the ranked list, the info card, and the exported
 * rankings CSV that feeds the draft board and roster import — reads the
 * ranking derived from them, so editing either visibly moves the player.
 *
 * Total rank and position rank are deliberately NOT stored: boardRanking.js
 * derives both from (group, withinGroup, positional value). Two numbers read
 * off one ordering cannot contradict each other or the board, and a rank
 * cannot be duplicated — which is why typing a rank is a move (insert and
 * shift, via ScoutingView's applyOrder) rather than an assignment.
 *
 * Because the ranking is derived per board, any view that shows a rank has to
 * rank the pool under the board it's displaying — see PlayerInfoModal, which
 * re-ranks when you page between analysts.
 */
import { parseCsvLine, csvField } from './csvUtils';

export const BOARDS = ['consensus', 'dan', 'ryan'];
export const BOARD_LABELS = { consensus: 'Consensus', dan: 'Dan', ryan: 'Ryan' };

// Each analyst has their own rankings file, and they are genuinely different
// boards — different players, different tiers, different order (Kevin
// Concepcion sits at 18 on consensus, 10 on Dan's, 28 on Ryan's). Switching
// board in Scouting therefore has to switch the underlying player pool too,
// not just the overlay of tags and notes laid on top of it.
export const BOARD_RANKINGS = {
    consensus: 'rankings_consensus.csv',
    dan: 'rankings_dan.csv',
    ryan: 'rankings_ryan.csv',
};

const storageKey = (board) => `scouting_overlay_v1__${board}`;

export function makeEntry(name, position) {
    return {
        name, position, tag: null,
        // group mirrors rankings.csv's own `group` column (e.g. "1.3" —
        // round 1, tier 3; CenterBoard reads the leading digits as the
        // round and treats the whole string as the tier-row key) so an
        // exported board slots straight into the app via exportRankingsCSV.
        group: null,
        // Position within this player's own tier. Total rank and position
        // rank are NOT stored — they're derived from group + withinGroup by
        // boardRanking.js, so they can never collide or contradict the board.
        withinGroup: null,
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
            name, position, group, tag, withinGroup,
            athleticMatrixTotal, athleticMatrixPosition,
            strengths, weaknesses, notes, updatedAt,
        ] = parseCsvLine(line);
        return {
            name: (name ?? '').trim(),
            position: (position ?? '').trim(),
            group: group && group.trim() ? group.trim() : null,
            tag: tag && tag.trim() ? tag.trim() : null,
            withinGroup: toIntOrNull(withinGroup),
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
            'name', 'position', 'group', 'tag', 'withinGroup',
            'athleticMatrixTotal', 'athleticMatrixPosition',
            'strengths', 'weaknesses', 'notes', 'updatedAt',
        ].map(csvField).join(','),
    ];
    state.entries.forEach(e => {
        rows.push([
            e.name, e.position, e.group ?? '', e.tag ?? '', e.withinGroup ?? '',
            e.athleticMatrixTotal ?? '', e.athleticMatrixPosition ?? '',
            JSON.stringify(e.strengths ?? []), JSON.stringify(e.weaknesses ?? []), JSON.stringify(e.notes ?? []),
            e.updatedAt,
        ].map(csvField).join(','));
    });
    return rows.join('\n');
}

// Board-ready export: just group,name,position — the exact shape
// rankings.csv/rankings_dan.csv/etc. use (see CLAUDE.md), so a board built in
// Scouting can be dropped straight into `public/` or loaded via `?rankings=`,
// and is what carries this board into the draft view and roster import.
//
// Takes the view's *effective* players (rankings with this board's rank/group
// overrides already applied, sorted by effective rank) rather than the
// overlay entries alone: the exported board is then exactly the board on
// screen, including every player the analyst never explicitly touched. An
// entries-only export silently dropped those.
export function exportRankingsCSV(effectivePlayers) {
    const rows = ['group,name,position'];
    (effectivePlayers ?? [])
        .filter(p => p?.name)
        .forEach(p => {
            rows.push([p.group ?? '', p.name, p.position ?? ''].map(csvField).join(','));
        });
    return rows.join('\n');
}
