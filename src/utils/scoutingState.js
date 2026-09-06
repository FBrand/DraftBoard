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
import { buildNameIndex, findMatchingIndex } from './nameMatcher';
import { parseTier, tierLabel, spaceEvenly } from './boardRanking';
import { boardById } from './boardRegistry';
import { ownerIdFor, remarksFor, REMARK_KINDS } from './evaluations';

// Each analyst has their own rankings file, and they are genuinely different
// boards — different players, different tiers, different order (Kevin
// Concepcion sits at 18 on consensus, 10 on Dan's, 28 on Ryan's). Switching
// board in Scouting therefore has to switch the underlying player pool too,
// not just the overlay of tags and notes laid on top of it.
//
// Which boards exist is no longer a constant here: see boardRegistry.js. A
// board is a record with an id, so an analyst can be renamed or replaced
// without the work moving.
const storageKey = (boardId) => `scouting_board_v1__${boardId}`;

// What the key was when a board was its own name.
const legacyKey = (slug) => `scouting_overlay_v1__${slug}`;

function readKey(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
            return { ...parsed, entries: unfuseGroups(parsed.entries) };
        }
    } catch { /* ignore */ }
    return null;
}

export function makeEntry(name, position, school = '', playerId = null) {
    return {
        // The player this entry is about. A name is not an identity — see
        // utils/playerRegistry.js — so the id is what joins an evaluation to
        // a player. Name/position/school stay alongside it so an entry is
        // still readable on its own, in an export or a corrupted store.
        playerId,
        // Name, position and school together are the player's identity — any
        // one differing makes him a different player (see nameMatcher). The
        // school is carried here so an entry can be told apart from a
        // namesake's at the same position.
        name, position, school, tag: null,
        // Where this analyst has placed him: a round and a tier, stored as
        // two numbers. rankings.csv fuses them into one "1.3" column, so the
        // joined form is produced on export and parsed on import — and
        // nowhere else.
        round: null,
        tier: null,
        // Position within this player's own tier. Total rank and position
        // rank are NOT stored — they're derived from group + withinGroup by
        // boardRanking.js, so they can never collide or contradict the board.
        withinGroup: null,
        athleticMatrixTotal: null, athleticMatrixPosition: null,
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

/**
 * Entries saved before round and tier were split still carry a joined "1.3"
 * `group` string. Converted on read rather than in a one-shot migration, so a
 * board written by an older build keeps working whenever it turns up.
 */
function unfuseGroups(entries) {
    return entries.map(e => {
        if (!('group' in e)) return e;
        const { group, ...rest } = e;
        return { ...rest, ...parseTier(group) };
    });
}

export function loadState(boardId) {
    const own = readKey(storageKey(boardId));
    if (own) return own;

    // A board written when the key was the analyst's name. Read once under the
    // old key and saved under the new one, so the work moves with the board
    // rather than being stranded by a rename.
    const slug = boardById(boardId)?.slug;
    const legacy = slug ? readKey(legacyKey(slug)) : null;
    if (legacy) {
        saveState(boardId, legacy);
        try { localStorage.removeItem(legacyKey(slug)); } catch { /* ignore */ }
        return legacy;
    }

    return { version: 1, entries: [] };
}

/**
 * Materialises a board from the rankings file, once.
 *
 * A CSV creates the initial state and nothing more. After this runs the board
 * is self-contained: every player has a stored placement, and the file is not
 * consulted again. Editing the file later changes nothing until it is
 * imported, which is the point — a board is the analyst's, not a live view of
 * somebody else's spreadsheet.
 *
 * Placements are spaced rather than consecutive, because `withinGroup` is a
 * float: a later move lands on the midpoint between two neighbours and writes
 * one player instead of renumbering the tier.
 *
 * A `*` in the file seeds a `like` tag at the same time, so the star and the
 * tag are one mechanic rather than two that can disagree.
 */
export function seedBoard(board, players) {
    if (!players?.length) return false;
    const state = loadState(board);
    if (state.seeded) return false;

    const entries = [...state.entries];
    const byId = new Map();
    entries.forEach((e, i) => { if (e.playerId) byId.set(e.playerId, i); });
    const index = buildNameIndex(entries);
    const seenPerTier = new Map();

    players.forEach(p => {
        const key = `${p.round}.${p.tier}`;
        const nth = seenPerTier.get(key) ?? 0;
        seenPerTier.set(key, nth + 1);

        const placement = {
            round: p.round ?? null,
            tier: p.tier ?? null,
            // Unplaced players get no order either — there is nothing to be
            // in order of until somebody tiers them.
            withinGroup: p.round == null ? null : spaceEvenly(nth),
        };

        let at = p.id != null && byId.has(p.id) ? byId.get(p.id) : -1;
        if (at === -1) at = findMatchingIndex(p.name, index, p);

        if (at !== -1) {
            entries[at] = {
                ...entries[at],
                playerId: entries[at].playerId ?? p.id ?? null,
                ...placement,
                tag: entries[at].tag ?? (p.isFavorite ? 'like' : null),
            };
        } else {
            const created = {
                ...makeEntry(p.name, p.position, p.school, p.id ?? null),
                ...placement,
                tag: p.isFavorite ? 'like' : null,
            };
            entries.push(created);
            index.push(...buildNameIndex([created]).map(e => ({ ...e, index: entries.length - 1 })));
            if (p.id != null) byId.set(p.id, entries.length - 1);
        }
    });

    saveState(board, { version: 1, seeded: true, entries });
    return true;
}

/**
 * Turns the rankings file's `*` favourites into real `like` tags on that
 * board, once, for players that have no entry yet.
 *
 * The star and the like tag were two mechanics for one idea: the star was
 * read straight off the CSV at render time while the tag lived in the board,
 * so un-liking a starred player did nothing and the two could disagree. Now
 * the star is only a *seed* — after this runs, the board's tag is the single
 * source of truth, and clearing it actually clears it.
 */
export function seedFavourites(board, players) {
    if (!players?.length) return false;
    const state = loadState(board);
    const entries = [...state.entries];
    const index = buildNameIndex(entries);
    let changed = false;

    players.forEach(p => {
        if (!p?.isFavorite) return;
        if (findMatchingIndex(p.name, index) !== -1) return; // already has an entry
        const seeded = { ...makeEntry(p.name, p.position, p.school, p.id ?? null), tag: 'like' };
        entries.push(seeded);
        index.push(...buildNameIndex([seeded]).map(e => ({ ...e, index: entries.length - 1 })));
        changed = true;
    });

    if (changed) saveState(board, { version: 1, entries });
    return changed;
}

/**
 * Stamps the registry id onto entries written before ids existed. Runs once
 * per board per load, against the pool that has just been resolved, so the
 * fuzzy match happens here and never again on the read path.
 */
export function attachPlayerIds(board, players) {
    const state = loadState(board);
    if (!state.entries.some(e => !e.playerId)) return false;

    const index = buildNameIndex(players);
    let changed = false;
    const entries = state.entries.map(e => {
        if (e.playerId) return e;
        const at = findMatchingIndex(e.name, index, e);
        const id = at === -1 ? null : players[at]?.id;
        if (!id) return e;
        changed = true;
        return { ...e, playerId: id };
    });

    if (changed) saveState(board, { ...state, entries });
    return changed;
}

export function saveState(boardId, state) {
    localStorage.setItem(storageKey(boardId), JSON.stringify(state));
}

export function parseCSV(csvText) {
    const lines = csvText
        .trim()
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.toLowerCase().startsWith('#') && !l.toLowerCase().startsWith('name,'));

    const entries = lines.map(line => {
        const [
            name, position, school, group, tag, withinGroup,
            athleticMatrixTotal, athleticMatrixPosition,
            strengths, weaknesses, notes, updatedAt,
        ] = parseCsvLine(line);
        return {
            name: (name ?? '').trim(),
            position: (position ?? '').trim(),
            school: (school ?? '').trim(),
            ...parseTier(group),
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

    return { version: 1, seeded: true, entries };
}

/**
 * The overlay export keeps its three remark columns, because the file is an
 * interchange format and hand-editable. They are filled from the evaluations
 * store rather than from the entry — remarks moved off boards, and reading
 * them from the entry silently exported nothing.
 */
export function exportCSV(state, board) {
    const rows = [
        '# Scouting Overlay Export',
        `# Exported: ${new Date().toISOString()}`,
        [
            'name', 'position', 'school', 'group', 'tag', 'withinGroup',
            'athleticMatrixTotal', 'athleticMatrixPosition',
            'strengths', 'weaknesses', 'notes', 'updatedAt',
        ].map(csvField).join(','),
    ];
    const ownerId = ownerIdFor(board);
    state.entries.forEach(e => {
        rows.push([
            e.name, e.position, e.school ?? '', tierLabel(e.round, e.tier), e.tag ?? '', e.withinGroup ?? '',
            e.athleticMatrixTotal ?? '', e.athleticMatrixPosition ?? '',
            ...REMARK_KINDS.map(kind => JSON.stringify(
                (ownerId && e.playerId ? remarksFor(ownerId, e.playerId) : [])
                    .filter(r => r.kind === kind)
                    .map(r => r.text),
            )),
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
            rows.push([tierLabel(p.round, p.tier), p.name, p.position ?? ''].map(csvField).join(','));
        });
    return rows.join('\n');
}
