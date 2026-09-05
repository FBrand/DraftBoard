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
import { repository } from '../data/repository';

/** One document per player. See data/repository.js. */
export const PLAYERS = 'players';

const LEGACY_KEY = 'player_registry_v1';
export const STATE_VERSION = 1;

/**
 * Loads the collection, carrying across the single-array store the registry
 * used before players were documents. Awaited once at startup; every read
 * after that is synchronous, off the repository's in-memory copy.
 */
export async function openRegistry() {
    await repository.ready(PLAYERS);
    if (repository.all(PLAYERS).length) return;

    let legacy = [];
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        legacy = Array.isArray(parsed?.players) ? parsed.players : [];
    } catch { /* nothing to carry across */ }

    if (!legacy.length) return;
    await repository.commit(PLAYERS, legacy.filter(p => p?.id).map(p => ({ id: p.id, doc: p })));
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

// The rest of this module reads and writes through the repository but keeps a
// synchronous surface: a board ranks 328 players on every keystroke and cannot
// await anything. Writes are fire-and-forget — the in-memory copy is updated
// before the promise settles, so the UI is already correct.
function writeOne(record) {
    repository.set(PLAYERS, record.id, record);
}

function writeMany(records) {
    repository.commit(PLAYERS, records.map(r => ({ id: r.id, doc: r })));
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
 * Facts about a player, as opposed to opinions about him.
 *
 * A fact is true whoever is looking, so it lives on the one record rather than
 * being copied onto each analyst's board — Dan and Ryan can disagree about
 * where a player belongs; they cannot disagree about who drafted him or what
 * he scored on the matrix.
 *
 * Two groups, because they behave differently:
 *
 *   League entry — how he got into the league, settled once and never again.
 *   `isUdfa` says which shape the rest takes: an undrafted player has a year
 *   but no round and no pick; a drafted one has all three. Round and overall
 *   pick are both kept because both get said out loud — "a third-rounder" and
 *   "pick 78" are not the same sentence.
 *
 *   Where he is — `team` is who has him now, the club that drafted or signed
 *   him. `previousTeam` is where he came from, which only means anything for a
 *   trade or a free-agent move; a rookie has no previous team.
 *
 * Every fact is null when nobody has recorded it, `isUdfa` included: null is
 * "we don't know", false is "he was drafted".
 *
 * Deliberately absent: combine and pro-day measurements (a note covers those
 * when they matter) and anything about contracts.
 */
export const FACT_FIELDS = [
    'athleticMatrixTotal', 'athleticMatrixPosition',
    'isUdfa', 'draftYear', 'draftRound', 'draftPick',
    'team', 'previousTeam',
];

const NUMERIC_FACTS = new Set([
    'athleticMatrixTotal', 'athleticMatrixPosition', 'draftYear', 'draftRound', 'draftPick',
]);
const BOOLEAN_FACTS = new Set(['isUdfa']);

const BLANK_FACTS = Object.fromEntries(FACT_FIELDS.map(f => [f, null]));

function cleanFact(field, value) {
    if (value === '' || value === null || value === undefined) return null;
    if (BOOLEAN_FACTS.has(field)) return !!value;
    if (NUMERIC_FACTS.has(field)) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : null;
    }
    return clean(value).toUpperCase() || null;
}

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
    return repository.all(PLAYERS);
}

export function byId(id) {
    return repository.get(PLAYERS, id);
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
    const players = repository.all(PLAYERS);
    const rows = lookupRows(players);
    const index = buildNameIndex(rows);
    const ids = [];
    const created = [];

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
            ...BLANK_FACTS,
            createdAt: new Date().toISOString(),
        };
        created.push(record);
        // Extend the index in step so a later candidate matches this record
        // instead of creating a second one for the same player.
        rows.push({ id: record.id, name: record.name, position: record.position, school: record.school });
        index.push(...buildNameIndex([rows[rows.length - 1]]).map(e => ({ ...e, index: rows.length - 1 })));
        ids.push(record.id);
    });

    // One commit for the whole batch: seeding a board resolves 328 players,
    // and that should be one write, not 328.
    if (created.length) writeMany(created);
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
    const before = repository.get(PLAYERS, id);
    if (!before) return false;

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

    writeOne(next);
    return true;
}

/** The facts recorded for a player, with nulls for the ones nobody has. */
export function factsFor(id) {
    const record = id ? repository.get(PLAYERS, id) : null;
    if (!record) return { ...BLANK_FACTS };
    return Object.fromEntries(FACT_FIELDS.map(f => [f, record[f] ?? null]));
}

/**
 * Merges facts onto a record. Only the fields passed are touched, so recording
 * a draft pick doesn't blank a matrix score somebody else entered. Passing
 * null or '' for a field clears it.
 */
export function setFacts(id, patch) {
    const record = repository.get(PLAYERS, id);
    if (!record) return false;

    const next = { ...record };
    let changed = false;
    FACT_FIELDS.forEach(f => {
        if (!(f in patch)) return;
        const value = cleanFact(f, patch[f]);
        if (next[f] === value) return;
        next[f] = value;
        changed = true;
    });
    if (!changed) return false;

    next.updatedAt = new Date().toISOString();
    writeOne(next);
    return true;
}

export function setHidden(id, hidden) {
    const record = repository.get(PLAYERS, id);
    if (!record) return false;
    writeOne({ ...record, hidden: !!hidden });
    return true;
}

/**
 * Folds `mergeId` into `keepId` — for when two records turn out to be one
 * person. The loser's identities become aliases of the winner, so anything
 * still resolving by his old name lands on the right record.
 */
export function merge(keepId, mergeId) {
    if (keepId === mergeId) return false;
    const keep = repository.get(PLAYERS, keepId);
    const loser = repository.get(PLAYERS, mergeId);
    if (!keep || !loser) return false;

    const aliases = [...(keep.aliases ?? []), ...(loser.aliases ?? []),
        { name: loser.name, position: loser.position, school: loser.school }];
    const seen = new Set();
    const deduped = aliases.filter(a => {
        const k = `${a.name}|${a.position}|${a.school}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    // One commit: the survivor gains the aliases and the loser goes, and
    // neither half of that should ever be visible without the other.
    repository.commit(PLAYERS, [
        { id: keepId, doc: { ...keep, aliases: deduped } },
        { id: mergeId, doc: null },
    ]);
    return true;
}

/** Test/reset hook — drops every record. */
export function clearRegistry() {
    return repository.clear(PLAYERS);
}
