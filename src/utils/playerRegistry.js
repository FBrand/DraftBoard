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
import { buildNameIndex, findMatchingIndex, nameKey } from './nameMatcher';
import { repository } from '../data/repository';
import { prefixedId } from './ids';
import { playerFields } from '../data/fieldNames';

/** One document per player. See data/repository.js. */
export const PLAYERS = 'players';

export const STATE_VERSION = 1;

/**
 * Loads the collection, carrying across the single-array store the registry
 * used before players were documents. Awaited once at startup; every read
 * after that is synchronous, off the repository's in-memory copy.
 */
export async function openRegistry() {
    await repository.ready(PLAYERS);
}

// The rest of this module reads and writes through the repository but keeps a
// synchronous surface: a board ranks 328 players on every keystroke and cannot
// await anything. Writes are fire-and-forget — the in-memory copy is updated
// before the promise settles, so the UI is already correct.
/**
 * A record without the fields that say nothing.
 *
 * Measured on the shipped season, of 733 records: both athletic-matrix scores
 * were null on every single one, so was previousTeam, `aliases` was an empty
 * array on all of them and `hidden` was false on all of them. That is 75KB of
 * a 246KB store spent writing down the absence of things.
 *
 * Safe because nothing reads these expecting null rather than nothing. Facts
 * go through `factsFor`, which is `record[f] ?? null`; aliases are read as
 * `(p.aliases ?? [])` in all three places; `hidden` is only ever tested for
 * truth. Absent and empty have always been the same answer — only the storage
 * disagreed.
 *
 * The timestamps are epoch milliseconds. Nothing reads them at all — they are
 * provenance, kept for the day somebody asks when a record appeared — and an
 * ISO string spends 24 characters carrying 13 characters of fact.
 */
function lean(record) {
    const out = {};
    Object.entries(record).forEach(([k, v]) => {
        // The id is the key this record is filed under. Writing it again cost
        // 33KB across 733 records, and gave a rename two places to go wrong:
        // a record whose id field disagrees with its key is a record nothing
        // can find twice the same way. Reattached on read, below.
        if (k === 'id') return;
        if (v === null || v === undefined) return;
        if (k === 'aliases' && Array.isArray(v) && v.length === 0) return;
        if (k === 'hidden' && v === false) return;
        if ((k === 'createdAt' || k === 'updatedAt') && typeof v === 'string') {
            const ms = Date.parse(v);
            out[k] = Number.isFinite(ms) ? ms : Date.now();
            return;
        }
        out[k] = v;
    });
    // Long names in the app, short ones in the store — field names were 43% of
    // this collection. See data/fieldNames.js.
    return playerFields.lean(out);
}

function writeOne(record) {
    repository.set(PLAYERS, record.id, lean(record));
}

function writeMany(records) {
    repository.commit(PLAYERS, records.map(r => ({ id: r.id, doc: lean(r) })));
}

/**
 * A new player id, checked against the registry rather than trusted to be
 * unique by length. See utils/ids.js — a collision here merges two people.
 */
const newId = (taken) => prefixedId('p', taken);

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

/**
 * Every player, each carrying its own id again.
 *
 * The id is not stored in the record — it is the key — so it is put back here.
 * Every caller reads `record.id`, and threading the key separately through the
 * matcher, the boards and the card would be a change to all of them for no
 * gain. One object spread, once per load.
 */
export function loadRegistry() {
    const map = repository.docs(PLAYERS) ?? {};
    return Object.entries(map).map(([id, doc]) => ({ ...playerFields.fat(doc), id }));
}

/**
 * Players whose name looks like what is being typed.
 *
 * For the add and sign forms, which had no way of showing you that the man you
 * are typing in is already known. Nothing warned, nothing offered him, and the
 * only feedback came after saving — as a duplicate record you could not see,
 * because the card that displays him resolves by name and finds the original.
 *
 * Returns null while the registry is still loading — see the note in the body.
 *
 * Matched on the folded name — punctuation, case, suffixes and nicknames —
 * rather than the raw string, so "dj moore", "D.J. Moore" and "DJ  Moore" all
 * find him. A prefix match on any word, because people type a surname.
 */
export function searchPlayers(term, limit = 6) {
    const typed = nameKey(String(term ?? '').trim());
    if (typed.length < 2) return [];
    // Null, not an empty list: "nobody by that name" and "I have not read the
    // registry yet" are different answers, and only one of them means it is
    // safe to add him. See repository.isLoaded.
    if (!repository.isLoaded(PLAYERS)) return null;

    const words = typed.split(/\s+/).filter(Boolean);
    const scored = [];

    loadRegistry().forEach(p => {
        if (p.hidden) return;
        const key = nameKey(p.name);
        if (key === typed) { scored.push({ player: p, score: 0 }); return; }
        if (key.startsWith(typed)) { scored.push({ player: p, score: 1 }); return; }
        // Every typed word appearing somewhere: "mendoza" finds him, and so
        // does "fernando mendoza" typed out of order.
        if (words.every(w => key.includes(w))) scored.push({ player: p, score: 2 });
    });

    return scored
        .sort((a, b) => a.score - b.score || a.player.name.localeCompare(b.player.name))
        .slice(0, limit)
        .map(s => s.player);
}

export function byId(id) {
    const doc = repository.get(PLAYERS, id);
    return doc ? { ...playerFields.fat(doc), id } : null;
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
    const players = loadRegistry();
    const rows = lookupRows(players);
    const index = buildNameIndex(rows);
    const ids = [];
    const created = [];
    // Every id in the collection, plus the ones minted during this very call —
    // resolveAll registers a whole rankings file at once, so the set has to
    // grow as it goes or two new players could collide with each other.
    const taken = new Set(players.map(x => x.id));

    (candidates ?? []).forEach(c => {
        const name = clean(c?.name);
        if (!name) { ids.push(null); return; }

        const at = findMatchingIndex(name, index, { position: c.position, school: c.school });
        if (at !== -1) { ids.push(rows[at].id); return; }
        if (!create) { ids.push(null); return; }

        const record = {
            id: newId(taken),
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
        taken.add(record.id);
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
    const before = byId(id);
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
    const record = id ? byId(id) : null;
    if (!record) return { ...BLANK_FACTS };
    return Object.fromEntries(FACT_FIELDS.map(f => [f, record[f] ?? null]));
}

/**
 * Merges facts onto a record. Only the fields passed are touched, so recording
 * a draft pick doesn't blank a matrix score somebody else entered. Passing
 * null or '' for a field clears it.
 */
export function setFacts(id, patch) {
    const record = byId(id);
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

/**
 * setFacts for many players in ONE write.
 *
 * Same semantics as setFacts — the fields passed are set, others untouched —
 * but the collection is serialised once instead of once per player. Seeding a
 * completed draft calls this for 639 players and importing a roster for 91;
 * done singly that was ~730 rewrites of a 700-record collection, which pinned
 * the main thread for fourteen seconds on a cold start. Nothing rendered, and
 * every browser-test wait timed out against elements that were plainly there.
 */
export function setFactsMany(updates) {
    const changes = [];

    (updates ?? []).forEach(({ id, patch }) => {
        const record = byId(id);
        if (!record || !patch) return;

        const next = { ...record };
        let changed = false;
        FACT_FIELDS.forEach(f => {
            if (!(f in patch)) return;
            const value = cleanFact(f, patch[f]);
            if (next[f] === value) return;
            next[f] = value;
            changed = true;
        });

        if (changed) {
            next.updatedAt = new Date().toISOString();
            changes.push({ id, doc: next });
        }
    });

    if (changes.length) repository.commit(PLAYERS, changes.map(c => ({ ...c, doc: c.doc ? lean(c.doc) : c.doc })));
    return changes.length;
}

/**
 * Applies base data and facts to many players in ONE write.
 *
 * The per-player calls each rewrite the whole collection, which is fine for a
 * correction somebody types and ruinous in a loop: seeding 257 players ran up
 * to 514 full-collection writes on every page load, each serialising ~686
 * records, and crashed the renderer.
 *
 * Only fills what a record does not already have — a value somebody entered
 * in the app is a deliberate act and outranks a seed.
 */
export function fillMany(updates) {
    const changes = [];

    (updates ?? []).forEach(({ id, base, facts }) => {
        const record = byId(id);
        if (!record) return;

        const next = { ...record };
        let changed = false;

        if (base?.school && !next.school) {
            next.school = clean(base.school);
            changed = true;
        }

        FACT_FIELDS.forEach(f => {
            if (!facts || !(f in facts)) return;
            if (next[f] != null) return;              // already known — leave it
            const value = cleanFact(f, facts[f]);
            if (value === null || next[f] === value) return;
            next[f] = value;
            changed = true;
        });

        if (changed) {
            next.updatedAt = new Date().toISOString();
            changes.push({ id, doc: next });
        }
    });

    if (changes.length) repository.commit(PLAYERS, changes.map(c => ({ ...c, doc: c.doc ? lean(c.doc) : c.doc })));
    return changes.length;
}

export function setHidden(id, hidden) {
    const record = byId(id);
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
    const keep = byId(keepId);
    const loser = byId(mergeId);
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
        { id: keepId, doc: lean({ ...keep, aliases: deduped }) },
        { id: mergeId, doc: null },
    ]);
    return true;
}

/** Test/reset hook — drops every record. */
export function clearRegistry() {
    return repository.clear(PLAYERS);
}
