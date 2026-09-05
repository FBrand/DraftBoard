/**
 * Prospects added inside the app, shared by every board.
 *
 * The rankings CSVs are a snapshot; players declare late, rise late, or simply
 * get missed. Before this, the only way to get someone onto a board was to
 * edit a file in public/ and redeploy — every in-app "unranked player" button
 * *disposes* of a player (drafts, signs, rosters him) rather than adding one.
 *
 * Base data only: who the player is, not what anyone thinks of him. Tier,
 * within-tier order, tags and notes stay per board in scoutingState, so a
 * prospect added by one analyst appears on every board untiered and untagged —
 * that he exists is a fact, where he belongs is an opinion.
 */
import { buildNameIndex, findMatchingIndex } from './nameMatcher';

const STORAGE_KEY = 'prospects_v1';
export const STATE_VERSION = 1;

const EMPTY = () => ({ version: STATE_VERSION, players: [], edits: [], hidden: [] });

function read() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return EMPTY();
        const parsed = JSON.parse(raw);
        if (typeof parsed?.version === 'number' && parsed.version > STATE_VERSION) {
            return EMPTY(); // written by a newer build
        }
        return {
            version: STATE_VERSION,
            players: Array.isArray(parsed?.players) ? parsed.players : [],
            edits: Array.isArray(parsed?.edits) ? parsed.edits : [],
            hidden: Array.isArray(parsed?.hidden) ? parsed.hidden : [],
        };
    } catch {
        return EMPTY();
    }
}

const identityOf = (p) => ({ name: p.name, position: p.position ?? '', school: p.school ?? '' });

/**
 * The identity a player was FIRST known by. A rankings-file player who has
 * been corrected in-app still has to be found by the identity the file gives
 * him, since the file is what he is re-read from on every load.
 */
const originOf = (p) => p?.sourceIdentity ?? identityOf(p);

function write(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
    } catch { /* ignore */ }
}

export function loadProspects() {
    return read().players;
}

/**
 * Shaped like a parsed rankings row so it can be concatenated straight into a
 * board's player pool, and carrying nothing that marks it as app-added — once
 * a player is on the board he is just a player.
 *
 * `group` is null on purpose: an added player starts UNRANKED. Where he
 * belongs is a judgement nobody has made yet, and guessing one would put a
 * player nobody has watched in among players who have been.
 */
export function toPoolPlayer(p) {
    return {
        name: p.name,
        position: p.position,
        school: p.school ?? '',
        group: null,
        isFavorite: false,
        overallRank: null,
        drafted: false,
        draftedByUs: false,
    };
}

/**
 * Classifies a name against the players already known — the rankings pool and
 * the prospects added so far.
 *
 *   'exact'     already there under this name
 *   'similar'   fuzzy-matches something; probably a typo, possibly a real
 *               second player with a similar name — a person has to say which
 *   'new'       no match
 *
 * The fuzzy matching is nameMatcher's (normalisation, suffix stripping,
 * nicknames, Levenshtein), the same machinery that joins scouting entries to
 * players, so detection costs nothing extra and behaves consistently.
 */
export function classify(name, existingPlayers, position = null) {
    const clean = String(name ?? '').trim();
    if (!clean) return { kind: 'empty' };

    const index = buildNameIndex(existingPlayers);
    const i = findMatchingIndex(clean, index, position);
    if (i === -1) return { kind: 'new' };

    const match = existingPlayers[i];
    const same = String(match.name).trim().toLowerCase() === clean.toLowerCase();
    return { kind: same ? 'exact' : 'similar', match };
}

/** Adds one prospect. Callers resolve collisions first; this does not check. */
export function addProspect({ name, position, school, addedBy = null }) {
    const state = read();
    state.players.push({
        name: String(name).trim(),
        position: String(position ?? '').trim().toUpperCase(),
        school: String(school ?? '').trim(),
        addedBy,
        createdAt: new Date().toISOString(),
    });
    write(state);
}

/**
 * Corrects a player's base data, whoever he came from.
 *
 * A player added in this app is edited in place. A player who came from a
 * rankings file is recorded as an OVERRIDE instead — the file is re-read on
 * every load and is not ours to rewrite, so the correction has to be something
 * we re-apply rather than something we save over. Either way the caller sees
 * one operation: within the app, a player is a player.
 */
export function savePlayerEdit(previous, patch) {
    const state = read();
    const clean = {
        name: String(patch.name ?? previous.name).trim(),
        position: String(patch.position ?? previous.position ?? '').trim().toUpperCase(),
        school: String(patch.school ?? previous.school ?? '').trim(),
    };

    const own = findMatchingIndex(previous.name, buildNameIndex(state.players), previous);
    if (own !== -1) {
        state.players[own] = { ...state.players[own], ...clean, updatedAt: new Date().toISOString() };
        write(state);
        return true;
    }

    const origin = originOf(previous);
    const at = findMatchingIndex(origin.name, buildNameIndex(state.edits.map(e => e.match)), origin);
    if (at !== -1) state.edits[at] = { ...state.edits[at], patch: { ...state.edits[at].patch, ...clean } };
    else state.edits.push({ match: origin, patch: clean });
    write(state);
    return true;
}

/**
 * Removes a player from every board. An in-app player is deleted outright; a
 * rankings-file player is recorded as hidden, since he comes back from the
 * file on the next load otherwise.
 */
export function deletePlayer(player) {
    const state = read();
    const own = findMatchingIndex(player.name, buildNameIndex(state.players), player);
    if (own !== -1) {
        state.players.splice(own, 1);
        write(state);
        return true;
    }

    const origin = originOf(player);
    if (findMatchingIndex(origin.name, buildNameIndex(state.hidden), origin) === -1) {
        state.hidden.push(origin);
    }
    write(state);
    return true;
}

/** Undoes a hide. Nothing else can bring a rankings-file player back. */
export function restorePlayer(identity) {
    const state = read();
    const at = findMatchingIndex(identity.name, buildNameIndex(state.hidden), identity);
    if (at === -1) return false;
    state.hidden.splice(at, 1);
    write(state);
    return true;
}

export function hiddenPlayers() {
    return read().hidden;
}

/**
 * The pool a board actually shows: the rankings file with in-app corrections
 * applied and hidden players dropped, plus the players added in-app. Added
 * players arrive with no tier — they exist, but nobody has placed them yet —
 * and are otherwise indistinguishable from the file's own.
 */
export function applyProspects(filePlayers) {
    const state = read();
    const editIndex = buildNameIndex(state.edits.map(e => e.match));
    const hiddenIndex = buildNameIndex(state.hidden);

    const fromFile = (filePlayers ?? []).reduce((out, p) => {
        if (findMatchingIndex(p.name, hiddenIndex, p) !== -1) return out;
        const at = findMatchingIndex(p.name, editIndex, p);
        // Corrected players keep a pointer back to the file's own identity, so
        // a second correction updates the same override rather than stacking.
        out.push(at !== -1 ? { ...p, ...state.edits[at].patch, sourceIdentity: state.edits[at].match } : p);
        return out;
    }, []);

    return state.players.length ? [...fromFile, ...state.players.map(toPoolPlayer)] : fromFile;
}

/**
 * Column order for an import. The first three are what the add form asks for,
 * so the simplest CSV is the same three fields typed by hand. The rest are
 * optional and only PREFILL the verification step — an import commits nothing
 * on its own, exactly like a typed row.
 */
export const CSV_COLUMNS = [
    'name', 'position', 'school',
    'tag', 'round', 'tier', 'rank', 'matrixTotal', 'matrixPosition',
];

export const CSV_TEMPLATE = `${CSV_COLUMNS.join(',')}\n`;

export function parseProspectCSV(text) {
    return String(text ?? '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .filter(l => !/^name\s*,/i.test(l))
        .map(line => {
            const cells = line.split(',').map(s => (s ?? '').trim());
            return Object.fromEntries(CSV_COLUMNS.map((col, i) => [col, cells[i] ?? '']));
        })
        .filter(r => r.name);
}
