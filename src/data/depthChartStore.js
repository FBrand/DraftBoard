/**
 * A depth chart as documents: one per position row.
 *
 * The roster and the free-agency board were one document each — the whole
 * chart in one value, rewritten on every edit. That is the same problem the
 * boards had: two people working on different parts of it are two whole-value
 * writes racing, and the later one wins with a copy that never saw the other.
 *
 * A ROW is the unit, because a row is where players stand. Moving somebody at
 * WR.Z writes WR.Z; the tackles are untouched and cannot be clobbered by
 * somebody who saved a moment later. A row carries its own configuration — its
 * label, how many of its slots are 53-man, where it sits in the order — because
 * those travel with it and splitting them apart would mean two writes to move
 * one row.
 *
 * Injured reserve and the cut panel stay one document each. They are flat
 * lists with no per-player structure to collide over, and a cut is an append.
 * If that changes, they split the same way.
 */
import { createDocSet } from './docSet';
import { repository } from './repository';
import { rowFields, slotFields } from './fieldNames';

/**
 * A slot list, short names in the store and long ones in the app.
 *
 * Nulls are load-bearing — an empty slot in the middle of a depth row is how
 * the chart says "nobody here yet" without closing the gap — so they survive
 * rather than being filtered out.
 */
const leanSlots = (slots) => (slots ?? []).map(x => (x ? slotFields.lean(x) : null));
const fatSlots = (slots) => (slots ?? []).map(x => (x ? slotFields.fat(x) : null));

/**
 * A chart's rows are a collection of their own.
 *
 *     seasons/{seasonId}/charts/{stage}/rows/{rowId}
 *
 * The key used to be `{season}__{stage}__{rowId}` in one shared collection,
 * and `readChart` gathered a chart by scanning it for a prefix. That is the
 * test for whether a composite key is earning its place: if something has to
 * scan the key to collect a subset, the subset wanted to be a collection.
 * Reading one roster meant walking every roster of every season.
 *
 * Two stages share the shape — the 53-man roster and free agency's candidate
 * board — so the stage is a path level rather than smuggled into the row id.
 * The cardinality stays small: seasons times two, about ten collections for
 * five seasons, which is the number of things ever loaded at once.
 */
/**
 * WHOSE chart, which the path used to have no room for.
 *
 * There was one roster and one free agency per season, writable by any expert,
 * last write wins, pushed live to everybody — so two analysts could not each
 * keep their own, and the one they shared belonged to whoever typed last.
 * Every stage is per person now (docs/SPEC.md §6), with one OFFICIAL version
 * of each: what the show says, as opposed to what any one analyst would do.
 *
 * The scope is a path level rather than part of a composite document id, for
 * the same reason the stage is — and for one more: firestore.rules has to tell
 * a person's own chart from the official one to decide who may write it, and a
 * rule matching a path segment is a comparison where a rule picking an id
 * apart is a regex.
 */
export const OFFICIAL = 'official';

/** Every scope this build can name, for scrapping a season. See removeChart. */
export const ALL_SCOPES = Symbol('all scopes');

/**
 * Whose chart, when the caller does not say: this person's own, or NOTHING.
 *
 * Null is an answer and callers must treat it as one. It used to fall back to
 * the string 'local', which on a local build is the CORRECT answer —
 * localAdapter.identity() genuinely returns it — and on a shared build is a
 * wrong one, because Firebase restores a session from IndexedDB a moment after
 * the page loads and identity() is null until it does. One value, two meanings,
 * nothing to tell them apart: the same mistake as a board that was its own name
 * and a remark whose id was its position.
 *
 * What it cost, in order: Roster mounts before the session is restored and
 * looks for a chart at scopes/local; nothing is there, because the real one is
 * under the uid; the bootstrap does what it is built to do and seeds a fresh
 * chart from the shipped file; the session finishes restoring; and the next save
 * writes that fresh chart over the real one. Nothing looks wrong at any step.
 * Meanwhile every write goes to scopes/local, which the rules refuse because
 * 'local' is nobody's uid.
 */
export const myScope = () => repository.identity();

/**
 * Whether anybody can be named yet.
 *
 * The distinction a stage needs before it decides it has no chart: "there is
 * nothing of yours" and "I do not yet know who you are" are the same absence
 * and must not be the same decision, because one of them seeds.
 */
export const scopeKnown = () => myScope() != null;

const chartAt = (stage, seasonId, scopeId) => `seasons/${seasonId ?? '_'}/charts/${stage}/scopes/${scopeId}`;
export const rowsPath = (stage, seasonId, scopeId = myScope()) => `${chartAt(stage, seasonId, scopeId)}/rows`;
export const bandsPath = (stage, seasonId, scopeId = myScope()) => `${chartAt(stage, seasonId, scopeId)}/bands`;

/**
 * Where every build before this one wrote: one chart per season, unscoped.
 *
 * Read, never written. Somebody who already has a roster there keeps seeing it
 * until he changes something, and the change lands in his own scope —
 * copy-on-write, the same migration shape the per-name board keys got. Nothing
 * is rewritten in place, so rolling the build back still finds its data.
 */
export const legacyRowsPath = (stage, seasonId) => `seasons/${seasonId ?? '_'}/charts/${stage}/rows`;
export const legacyBandsPath = (stage, seasonId) => `seasons/${seasonId ?? '_'}/charts/${stage}/bands`;

// One docSet per chart, made once and kept. The scope it is given is a
// formality now — the path already says which chart this is — so every call
// passes the same constant.
const SCOPE = 'c';
const sets = new Map();

function setAt(path) {
    if (!sets.has(path)) {
        sets.set(path, createDocSet({
            collection: path,
            // rowId, not id: the item handed in is a row to be filed, and the
            // id is what it will be filed AS. Reading the wrong one gave every
            // row the same document and the chart collapsed to whichever row
            // was written last.
            idOf: (_scope, row) => row.rowId,
            keyField: 'rowId',
            scopeOf: () => true,
            // `doc.id` is the key docSet reattaches on read, and the key IS
            // the rowId — idOf says so. The row used to store `rowId` as well,
            // which is the document stating its own address, the one thing
            // every other collection here stopped doing.
            // Long names in the app, short ones in the store — field names
            // were 45% of this collection. See fieldNames.js.
            strip: (doc) => {
                const row = rowFields.fat(doc);
                return {
                    id: doc.id ?? row.rowId,
                    label: row.label,
                    slots53: row.slots53,
                    phase: row.phase,
                    slots: fatSlots(row.slots),
                };
            },
        }));
    }
    return sets.get(path);
}

/**
 * The stages that keep a depth chart. Both are read by season.
 *
 * Named here rather than imported from the two stores, because those import
 * this one.
 */
export const CHART_STAGES = ['rosterState', 'fa_state_v1'];

/** This person's own chart, by name. Written to; never fallen back from. */
const ownPaths = (stage, seasonId, scopeId) => ({
    rows: rowsPath(stage, seasonId, scopeId),
    bands: bandsPath(stage, seasonId, scopeId),
});

/**
 * Where a read for this scope actually comes from.
 *
 * His own if he has one; otherwise the OFFICIAL chart; otherwise whatever an
 * older build left at the unscoped path. That order is the whole of
 * copy-on-write: somebody with no chart of his own is looking at official, and
 * the first thing he changes is written into his own scope, where it wins from
 * then on. Nobody has to choose a starting point before starting.
 *
 * A write NEVER consults this. Falling back on the way in is how one person's
 * edit lands in everybody's chart.
 */
function readFrom(stage, seasonId, scopeId) {
    const official = ownPaths(stage, seasonId, OFFICIAL);
    // Nobody named yet: official, or the legacy path, and never a scope built
    // out of a placeholder.
    if (scopeId == null) {
        if (setAt(official.rows).has(SCOPE)) return official;
        const legacyOnly = { rows: legacyRowsPath(stage, seasonId), bands: legacyBandsPath(stage, seasonId) };
        return setAt(legacyOnly.rows).has(SCOPE) ? legacyOnly : official;
    }

    const own = ownPaths(stage, seasonId, scopeId);
    if (setAt(own.rows).has(SCOPE)) return own;

    if (scopeId !== OFFICIAL && setAt(official.rows).has(SCOPE)) return official;

    const legacy = { rows: legacyRowsPath(stage, seasonId), bands: legacyBandsPath(stage, seasonId) };
    if (setAt(legacy.rows).has(SCOPE)) return legacy;

    return own;
}

/**
 * Loads a season's charts, so a synchronous read can answer for them.
 *
 * This returned a resolved promise and loaded nothing, on the reasoning that a
 * chart's rows "load on demand at its own path" — true of localStorage, where
 * `loadSync` fills a collection the instant anything asks, and false of every
 * other store. Against Firestore `hasChart()` therefore answered NO for a
 * roster that was sitting right there, and the stage seeded itself from the
 * shipped file instead: the shared roster was replaced, locally, by the one the
 * app ships with. Measured — a name changed in Firestore never reached the
 * screen.
 *
 * The third of this shape, after `openBoardEntries` and `openSetup`. All three
 * said the same thing in the same words.
 */
export function openDepthCharts(seasonId, scopeId = myScope()) {
    if (!seasonId) return Promise.resolve();
    // Mine and official both, because a read falls back from the first to the
    // second and cannot fall back to a collection nobody has loaded. With no
    // scope yet, official alone — there is no "mine" to open.
    const scopes = (scopeId === OFFICIAL || scopeId == null) ? [OFFICIAL] : [scopeId, OFFICIAL];
    const paths = CHART_STAGES.flatMap(stage => scopes.flatMap(sc => [
        rowsPath(stage, seasonId, sc),
        bandsPath(stage, seasonId, sc),
    ]));

    // The unscoped path only matters where an older build of THIS app wrote
    // one, which is a local store. Reading it on a shared backend would be two
    // more collection reads per stage, per load, for data that cannot be there:
    // the seeder writes official.
    if (!repository.isLive()) {
        CHART_STAGES.forEach(stage => paths.push(legacyRowsPath(stage, seasonId), legacyBandsPath(stage, seasonId)));
    }

    return Promise.all(paths.map(path => repository.ready(path)));
}

/** Whether anything would be read for this scope, his own or fallen back to. */
export function hasChart(stage, seasonId, scopeId = myScope()) {
    return setAt(readFrom(stage, seasonId, scopeId).rows).has(SCOPE);
}

/** Whether he has one OF HIS OWN, as opposed to looking at somebody else's. */
export function hasOwnChart(stage, seasonId, scopeId = myScope()) {
    // Nobody named yet is nobody's chart. Answering otherwise would have a
    // stage treat official as its own and save over it.
    if (scopeId == null) return false;
    return setAt(rowsPath(stage, seasonId, scopeId)).has(SCOPE);
}

/**
 * The chart in the shape every caller already reads:
 * `{ positionConfig: { offense, defense }, depthChart, reserve, cuts }`.
 */
export function readChart(stage, seasonId, scopeId = myScope()) {
    const from = readFrom(stage, seasonId, scopeId);
    const all = setAt(from.rows).read(SCOPE);

    const positionConfig = { offense: [], defense: [] };
    const depthChart = {};
    all.forEach(({ id, label, slots53, phase, slots }) => {
        depthChart[id] = slots;
        if (phase === 'offense' || phase === 'defense') {
            positionConfig[phase].push({ id, label, slots53 });
        }
    });

    const band = (name) => fatSlots(repository.get(from.bands, name)?.s);

    // Which shape this was written in. Absent for a chart written before the
    // version was recorded, and that is not an error: it is the shape this app
    // writes, so the caller reads it as current — the same reading
    // `rosterState.migrate` gives unversioned data.
    const version = repository.get(from.bands, 'meta')?.v;

    const chart = { positionConfig, depthChart, reserve: band('reserve'), cuts: band('cuts') };
    if (typeof version === 'number') chart.version = version;
    return chart;
}

/**
 * The shape a stored chart was written in, or null when it does not say.
 *
 * For the one question a writer has to ask before overwriting: is what is
 * already there from a build newer than mine?
 */
export function chartVersion(stage, seasonId, scopeId = myScope()) {
    const v = repository.get(readFrom(stage, seasonId, scopeId).bands, 'meta')?.v;
    return typeof v === 'number' ? v : null;
}

export function writeChart(stage, seasonId, state, scopeId = myScope()) {
    // Refused while nobody is named, exactly as a chart with no season is
    // refused: the identity arrives a moment later and the next save has
    // somewhere to go. Filing under a placeholder instead is what let a
    // freshly-seeded chart be written over a real one.
    if (scopeId == null) return;

    // His own scope, always. See readFrom for why a write must not fall back.
    const rows = rowsPath(stage, seasonId, scopeId);
    const bands = bandsPath(stage, seasonId, scopeId);
    const { positionConfig = { offense: [], defense: [] }, depthChart = {} } = state;

    // Rows in display order, offense then defense, each carrying its slots.
    // The specialists have no phase — they are their own row with one slot and
    // no place in either list, which is why phase is stored rather than
    // inferred from which array a row was found in.
    const list = [];
    ['offense', 'defense'].forEach(phase => {
        (positionConfig[phase] ?? []).forEach(chip => {
            list.push({
                rowId: chip.id,
                ...rowFields.lean({
                    label: chip.label,
                    slots53: chip.slots53,
                    phase,
                    slots: leanSlots(depthChart[chip.id]),
                }),
            });
        });
    });
    const configured = new Set(list.map(r => r.rowId));
    Object.keys(depthChart).forEach(rowId => {
        if (configured.has(rowId)) return;
        list.push({
            rowId,
            ...rowFields.lean({
                label: rowId, slots53: 1, phase: null, slots: leanSlots(depthChart[rowId]),
            }),
        });
    });

    setAt(rows).write(SCOPE, list);

    // A band document is its slots. It used to also carry `id`, `scope` and
    // `band` — the whole key, its left half, and its right half — which was
    // 111 of its 219 bytes spent restating where it is filed.
    const band = (name, slots) => {
        const path = bands;
        const before = repository.get(path, name);
        const next = { s: leanSlots(slots) };
        // An empty band that nobody has stored is not a change, it is the
        // absence of one. Writing it anyway put a document in this browser
        // that says "nothing on reserve" — which then SHADOWS whatever the
        // shared store has, because the local overlay wins. A viewer who has
        // touched nothing was quietly overriding the expert's reserve list
        // with his own emptiness.
        if (!before && !next.s.length) return;
        if (!before || JSON.stringify(before.s ?? []) !== JSON.stringify(next.s)) {
            repository.set(path, name, next);
        }
    };
    band('reserve', state.reserve);
    band('cuts', state.cuts);

    // The shape this was written in, so a later build can tell.
    //
    // `rosterState.migrate` and `faState.migrate` both refuse a chart from a
    // NEWER app rather than guess at it, and the header above STATE_VERSION
    // says what that guard is for: without a version there was no way to tell
    // an old shape from a current one, so a stale blob was trusted and
    // rendered wrong. The guard stopped working the moment the chart stopped
    // being a blob — nothing wrote a version any more, and neither caller can
    // spread one in from a read that does not carry it. Two files described a
    // protection that could not fire.
    const version = typeof state.version === 'number' ? state.version : null;
    if (version !== null) {
        const path = bands;
        const before = repository.get(path, 'meta');
        if (!before || before.v !== version) repository.set(path, 'meta', { v: version });
    }
}

/**
 * Scraps a chart. One scope at a time, or every one this build can name.
 *
 * A season rollback wants all of them, and cannot enumerate the scopes of
 * experts who are not here — so it clears this person's, the official one, and
 * the unscoped legacy. Another expert's personal chart for a purged season
 * outlives the season; it is unreachable rather than wrong, and enumerating
 * scopes would mean a collection listing on every rollback.
 */
/**
 * Who published the official chart, and when.
 *
 * Any expert may publish over any other's, so without this the first question
 * after a bad publish — who did that, and when — has no answer. It is one
 * document beside the bands, written only by publishOfficial.
 *
 * The writer is recorded as an id, not a name: a name is somebody's current
 * label and this is a record of an act. Callers resolve it for display.
 */
export function writeStamp(stage, seasonId, scopeId = myScope()) {
    repository.set(bandsPath(stage, seasonId, OFFICIAL), 'stamp', { by: scopeId, at: new Date().toISOString() });
}

/** The publication stamp, or null where nothing has been published. */
export function readStamp(stage, seasonId) {
    const stamp = repository.get(bandsPath(stage, seasonId, OFFICIAL), 'stamp');
    return stamp?.by ? { by: stamp.by, at: stamp.at ?? null } : null;
}

export function removeChart(stage, seasonId, scopeId = myScope()) {
    if (scopeId == null) return Promise.resolve([]);
    const targets = scopeId === ALL_SCOPES
        ? [ownPaths(stage, seasonId, myScope()), ownPaths(stage, seasonId, OFFICIAL),
            { rows: legacyRowsPath(stage, seasonId), bands: legacyBandsPath(stage, seasonId) }]
        : [ownPaths(stage, seasonId, scopeId)];

    return Promise.all(targets.flatMap(({ rows, bands }) => [
        setAt(rows).removeAll(SCOPE),
        repository.remove(bands, 'reserve'),
        repository.remove(bands, 'cuts'),
        repository.remove(bands, 'meta'),
    ]));
}
