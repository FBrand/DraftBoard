/**
 * One canonical record per player, with a stable id.
 *
 * Until now a player WAS his name: every store keyed on it, and every read
 * re-derived identity by fuzzy-matching that name against a list. That is why
 * the same question kept coming back in different disguises — two men sharing
 * a name, a rename that had to be hand-migrated across three boards and the
 * matrix store, two analysts labelling one player at different positions. Each
 * was the same missing thing: nothing to point at.
 *
 * An id is opaque and permanent. It survives a rename, which a key derived
 * from the name cannot. Fuzzy matching still happens — it has to, because the
 * data arrives as names — but it happens ONCE, here, when a name is first
 * resolved to a record, and never again on the read path.
 *
 * This is also the shape a backend needs: a document store keys on ids, and
 * cannot fuzzy-match server-side. Everything downstream keying on `playerId`
 * is what makes that move a change of adapter rather than a rewrite.
 */
import { buildNameIndex, findMatchingIndex } from './nameMatcher';

const STORAGE_KEY = 'player_registry_v1';
export const STATE_VERSION = 1;

const EMPTY = () => ({ version: STATE_VERSION, players: [] });

function read() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return EMPTY();
        const parsed = JSON.parse(raw);
        if (typeof parsed?.version === 'number' && parsed.version > STATE_VERSION) return EMPTY();
        return {
            version: STATE_VERSION,
            players: Array.isArray(parsed?.players) ? parsed.players : [],
        };
    } catch {
        return EMPTY();
    }
}

function write(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
    } catch { /* ignore */ }
}

let nextFallbackId = 0;
function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `p_${crypto.randomUUID()}`;
    }
    nextFallbackId += 1;
    return `p_${Date.now().toString(36)}${nextFallbackId.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const clean = (v) => String(v ?? '').trim();

/**
 * Every name a record has ever been known by, flattened so one fuzzy pass can
 * match against all of them. A renamed player still resolves from his old name
 * — the rankings file keeps handing us that name on every load.
 */
function lookupRows(players) {
    const rows = [];
    players.forEach(p => {
        rows.push({ id: p.id, name: p.name, position: p.position, school: p.school });
        (p.aliases ?? []).forEach(a => {
            rows.push({ id: p.id, name: a.name, position: a.position, school: a.school });
        });
    });
    return rows;
}

export function loadRegistry() {
    return read().players;
}

export function byId(id) {
    return read().players.find(p => p.id === id) ?? null;
}

/**
 * Resolves many players at once, creating records for the ones not seen
 * before. Batched on purpose: the name index is built once for the whole call
 * rather than per lookup, which is the difference between one pass and a
 * quadratic one over a 300-player file.
 *
 * Returns ids positionally matching `candidates`.
 */
export function resolveAll(candidates, { create = true } = {}) {
    const state = read();
    const rows = lookupRows(state.players);
    const index = buildNameIndex(rows);
    const ids = [];
    let changed = false;

    (candidates ?? []).forEach(c => {
        const name = clean(c?.name);
        if (!name) { ids.push(null); return; }

        const at = findMatchingIndex(name, index, { position: c.position, school: c.school });
        if (at !== -1) { ids.push(rows[at].id); return; }
        if (!create) { ids.push(null); return; }

        const record = {
            id: newId(),
            name,
            position: clean(c.position).toUpperCase(),
            school: clean(c.school),
            aliases: [],
            hidden: false,
            createdAt: new Date().toISOString(),
        };
        state.players.push(record);
        // Extend the index in step so a later candidate matches this record
        // instead of creating a second one for the same player.
        rows.push({ id: record.id, name: record.name, position: record.position, school: record.school });
        index.push(...buildNameIndex([rows[rows.length - 1]]).map(e => ({ ...e, index: rows.length - 1 })));
        ids.push(record.id);
        changed = true;
    });

    if (changed) write(state);
    return ids;
}

/** Single-player convenience. Prefer resolveAll when handling a list. */
export function resolve(candidate, options) {
    return resolveAll([candidate], options)[0];
}

/**
 * Corrects a record's base data. The identity it previously answered to is
 * kept as an alias, so a rankings file that still carries the old spelling
 * keeps resolving to this record rather than creating a duplicate on the next
 * load.
 */
export function rename(id, patch) {
    const state = read();
    const at = state.players.findIndex(p => p.id === id);
    if (at === -1) return false;

    const before = state.players[at];
    const next = {
        ...before,
        name: clean(patch.name ?? before.name),
        position: clean(patch.position ?? before.position).toUpperCase(),
        school: clean(patch.school ?? before.school),
        updatedAt: new Date().toISOString(),
    };
    const same = next.name === before.name && next.position === before.position
        && next.school === before.school;
    if (same) return false;

    const aliases = [...(before.aliases ?? [])];
    const known = (a) => a.name === before.name && a.position === before.position
        && a.school === before.school;
    if (!aliases.some(known)) {
        aliases.push({ name: before.name, position: before.position, school: before.school });
    }
    next.aliases = aliases;

    state.players[at] = next;
    write(state);
    return true;
}

export function setHidden(id, hidden) {
    const state = read();
    const at = state.players.findIndex(p => p.id === id);
    if (at === -1) return false;
    state.players[at] = { ...state.players[at], hidden: !!hidden };
    write(state);
    return true;
}

/**
 * Folds `mergeId` into `keepId` — for when two records turn out to be one
 * person. The loser's identities become aliases of the winner, so anything
 * still resolving by his old name lands on the right record.
 */
export function merge(keepId, mergeId) {
    if (keepId === mergeId) return false;
    const state = read();
    const keep = state.players.find(p => p.id === keepId);
    const loser = state.players.find(p => p.id === mergeId);
    if (!keep || !loser) return false;

    const aliases = [...(keep.aliases ?? []), ...(loser.aliases ?? []),
        { name: loser.name, position: loser.position, school: loser.school }];
    const seen = new Set();
    keep.aliases = aliases.filter(a => {
        const k = `${a.name}|${a.position}|${a.school}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    state.players = state.players.filter(p => p.id !== mergeId);
    write(state);
    return true;
}

/** Test/reset hook — drops every record. */
export function clearRegistry() {
    write(EMPTY());
}
