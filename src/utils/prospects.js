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
import { buildNameIndex, findMatchingIndex, findCompatibleIndex } from './nameMatcher';
import { readStage } from '../data/stageStore';
import { repository } from '../data/repository';
import {
    aboutKey, hiddenPath, readEdits, readHidden, readProspects,
    removeHidden, removeProspect, writeEdit, writeHidden, writeProspect,
} from '../data/prospectStore';
import { viewedSeason } from './boardRegistry';

// Which season's copy of this stage. Read at call time, never cached: the
// answer changes when somebody switches season, and a stage holding the
// previous answer would write one season's work into another's key.
const seasonId = () => viewedSeason()?.id ?? null;

import { parseRemarksCell, splitRecords } from './boardCsv';
import { parseCsvLine } from './csvUtils';

const STORAGE_KEY = 'prospects_v1';
export const STATE_VERSION = 1;

const EMPTY = () => ({ version: STATE_VERSION, players: [], edits: [], hidden: [] });

/**
 * Everything this season holds, assembled from the documents holding it.
 *
 * The three lists used to be one stage blob, and every mutation rewrote all of
 * it — so two experts adding a player lost one of them, silently, with the
 * player on both their screens until a reload. They are documents now
 * (data/prospectStore.js) and this reads them back into the shape the rest of
 * this file already expects.
 *
 * The legacy blob is still READ, and per-record documents win over it. Nothing
 * rewrites it: whatever it holds is somebody's work, and converting it in place
 * would mean a migration write on a load — the one place this app has already
 * crashed a renderer doing bulk writes at boot. It converts a record at a time,
 * as each is touched.
 */
function read() {
    try {
        const sid = seasonId();
        const legacy = readStage(STORAGE_KEY, sid);
        const stale = typeof legacy?.version === 'number' && legacy.version > STATE_VERSION;
        const old = (!legacy || stale) ? EMPTY() : {
            players: Array.isArray(legacy?.players) ? legacy.players : [],
            edits: Array.isArray(legacy?.edits) ? legacy.edits : [],
            hidden: Array.isArray(legacy?.hidden) ? legacy.hidden : [],
        };

        // Per-record first, so a converted record shadows its old copy rather
        // than appearing twice.
        const rows = readProspects(sid);
        const edits = readEdits(sid);
        const hidden = readHidden(sid);

        // A record knows which blob entry it replaced, where it replaced one.
        // Without that, correcting a blob player writes a document under his
        // NEW identity — a different key — and the blob copy no longer matches
        // anything, so he appears twice. The blob is never rewritten, so the
        // record has to carry the exclusion itself.
        const known = new Set(rows.flatMap(r => [aboutKey(identityOf(r)), r.from].filter(Boolean)));
        const editedAbout = new Set(edits.map(e => aboutKey(e.match)));
        const hiddenAbout = new Set(hidden.map(h => aboutKey(h)));

        return {
            version: STATE_VERSION,
            players: [...rows, ...old.players.filter(pl => !known.has(aboutKey(identityOf(pl))))],
            edits: [...edits, ...old.edits.filter(e => !editedAbout.has(aboutKey(e.match)))],
            hidden: [...hidden, ...old.hidden.filter(h => !hiddenAbout.has(aboutKey(h)))],
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

// Nothing writes the blob any more. Each mutator writes the one record it
// changes — see data/prospectStore.js for why, and read() above for how the old
// blob is still honoured on the way in.

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
        round: null,
        tier: null,
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
    if (i === -1) {
        // Before calling him new: is there somebody of this name whose only
        // difference is a position the two sources could BOTH be right about?
        //
        // This is where the registry's duplicates came from. A rankings file
        // says Francis Mauigoa, IOL; the facts file says Francis Mauigoa, OT,
        // Miami. The names match, the schools cannot disagree because one side
        // has none, and the positions differ — so the match was refused and a
        // second record minted for a man who already had one. Seven players
        // are in the live registry twice for exactly this reason, every pair a
        // compatible one: OT/IOL, EDGE/DL, IOL.G/OT, DL.3T/EDGE.
        //
        // Reported as 'similar', not merged. Compatible is not the same as
        // identical — two men called Chris Jones, one an edge and one a
        // tackle, look exactly like this — so it goes to the person who can
        // tell, through the collision step Add Players already has. The
        // strict path above is untouched, which is what keeps boot from
        // silently merging anything while nobody is watching.
        const c = findCompatibleIndex(clean, index, position);
        if (c === -1) return { kind: 'new' };
        return { kind: 'similar', match: existingPlayers[c], reason: 'position' };
    }

    const match = existingPlayers[i];
    const same = String(match.name).trim().toLowerCase() === clean.toLowerCase();
    return { kind: same ? 'exact' : 'similar', match };
}

/** Adds one prospect. Callers resolve collisions first; this does not check. */
export function addProspect({ name, position, school, addedBy = null }) {
    if (!seasonId()) return;
    const player = {
        name: String(name).trim(),
        position: String(position ?? '').trim().toUpperCase(),
        school: String(school ?? '').trim(),
        addedBy,
        createdAt: new Date().toISOString(),
    };
    // Keyed by who he is, so adding the same player twice is one document
    // rather than two — and so two experts adding two DIFFERENT players write
    // two documents instead of overwriting each other's list.
    writeProspect(seasonId(), aboutKey(identityOf(player)), player);
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
        const before = state.players[own];
        const next = { ...before, ...clean, updatedAt: new Date().toISOString() };
        // A rename changes who he is, so it changes the document he belongs in:
        // written under the new identity and the old document dropped, rather
        // than left behind as a second copy of the same man.
        const wasAt = before.__id ?? aboutKey(identityOf(before));
        const nowAt = aboutKey(identityOf(next));
        delete next.__id;
        // Where he came from, kept only when it differs: a corrected player is
        // filed under who he is NOW, and read() needs to know which blob entry
        // — or which earlier document — this one supersedes. `from` follows the
        // chain rather than resetting, so a second correction still excludes
        // the original.
        if (wasAt !== nowAt) next.from = before.from ?? wasAt;
        writeProspect(seasonId(), nowAt, next);
        if (wasAt !== nowAt && before.__id) removeProspect(seasonId(), wasAt);
        return true;
    }

    const origin = originOf(previous);
    const at = findMatchingIndex(origin.name, buildNameIndex(state.edits.map(e => e.match)), origin);
    const merged = at !== -1 ? { ...state.edits[at].patch, ...clean } : clean;
    writeEdit(seasonId(), origin, merged);
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
        const found = state.players[own];
        removeProspect(seasonId(), found.__id ?? aboutKey(identityOf(found)));
        return true;
    }

    // Keyed by the identity it is about, so hiding him twice is the same
    // document. The array version searched first, and a search that missed left
    // a duplicate marker nobody could remove.
    writeHidden(seasonId(), originOf(player));
    return true;
}

/** Undoes a hide. Nothing else can bring a rankings-file player back. */
export function restorePlayer(identity) {
    const state = read();
    const at = findMatchingIndex(identity.name, buildNameIndex(state.hidden), identity);
    if (at === -1) return false;
    const found = state.hidden[at];
    // By the document it is in where it has one, by the identity it is about
    // otherwise — a marker still living in the old blob has no document id, and
    // hiding is idempotent, so the key derived from the identity finds it.
    if (found.__id) repository.remove(hiddenPath(seasonId()), found.__id);
    else removeHidden(seasonId(), found);
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
    // What the analyst actually said about him. One cell, one remark per
    // line, marked by its symbol — see boardCsv.formatRemarksCell for why it
    // is prefixed "Remarks:" (a cell starting with + or - is read as a formula
    // by Sheets and Excel, and the contents are mangled before you ever save).
    'evaluation',
];

export const CSV_TEMPLATE = `${CSV_COLUMNS.join(',')}\n`;

export function parseProspectCSV(text) {
    // Split on records rather than lines, and parse cells properly: the
    // evaluation cell holds several lines inside one quoted field, and a
    // player's name may contain a comma. Splitting on "," and "\n" turned
    // both into gibberish.
    const records = splitRecords(String(text ?? '').split(/\r?\n/))
        .filter(l => l.trim() && !l.trim().startsWith('#'))
        .filter(l => !/^name\s*,/i.test(l.trim()));

    return records.map(record => {
        const cells = parseCsvLine(record);
        const row = Object.fromEntries(CSV_COLUMNS.map((col, i) => [col, (cells[i] ?? '').trim()]));

        // Remarks arrive as one cell and are split back into the three lists
        // the verification step and the board entry already speak.
        const remarks = parseRemarksCell(row.evaluation);
        row.strengths = remarks.filter(r => r.kind === 'strength').map(r => r.text);
        row.weaknesses = remarks.filter(r => r.kind === 'weakness').map(r => r.text);
        row.notes = remarks.filter(r => r.kind === 'note').map(r => r.text);
        return row;
    }).filter(r => r.name);
}
