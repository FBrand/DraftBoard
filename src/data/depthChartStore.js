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

/** The pre-path collections. Read once for migration; never written. */
export const DEPTH_ROWS = 'depth_rows';
export const DEPTH_BANDS = 'depth_bands';

/** Which chart a row belongs to: one stage, one season. */
export const chartScope = (stage, seasonId) => `${seasonId ?? '_'}__${stage}`;

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
export const rowsPath = (stage, seasonId) => `seasons/${seasonId ?? '_'}/charts/${stage}/rows`;
export const bandsPath = (stage, seasonId) => `seasons/${seasonId ?? '_'}/charts/${stage}/bands`;

// One docSet per chart, made once and kept. The scope it is given is a
// formality now — the path already says which chart this is — so every call
// passes the same constant.
const SCOPE = 'c';
const sets = new Map();

function rowsOf(stage, seasonId) {
    const path = rowsPath(stage, seasonId);
    if (!sets.has(path)) {
        sets.set(path, createDocSet({
            collection: path,
            // rowId, not id: the item handed in is a row to be filed, and the
            // id is what it will be filed AS. Reading the wrong one gave every
            // row the same document and the chart collapsed to whichever row
            // was written last.
            idOf: (_scope, row) => row.rowId,
            scopeOf: () => true,
            strip: (doc) => ({
                id: doc.rowId,
                label: doc.label,
                slots53: doc.slots53,
                phase: doc.phase,
                slots: doc.slots ?? [],
            }),
        }));
    }
    return sets.get(path);
}

/**
 * Moves a chart under its season, once, the first time it is looked at.
 *
 * Same shape as the board-entry move: read at the old address, rewrite at the
 * new one, drop the old. Runs at most once per chart, because afterwards the
 * shared collection holds nothing under that prefix.
 */
function migrateChart(stage, seasonId) {
    const scope = chartScope(stage, seasonId);
    const legacy = repository.docs(DEPTH_ROWS) ?? {};
    const prefix = `${scope}__`;
    const mine = Object.entries(legacy).filter(([id, doc]) => doc && id.startsWith(prefix));
    if (mine.length) {
        repository.commit(rowsPath(stage, seasonId), mine.map(([id, doc]) => ({
            id: id.slice(prefix.length),
            doc: { ...doc, rowId: doc.rowId ?? id.slice(prefix.length) },
        })));
        repository.commit(DEPTH_ROWS, mine.map(([id]) => ({ id, doc: null })));
    }

    ['reserve', 'cuts'].forEach(name => {
        const old = repository.get(DEPTH_BANDS, `${scope}__${name}`);
        if (!old) return;
        repository.set(bandsPath(stage, seasonId), name, { slots: old.slots ?? [] });
        repository.remove(DEPTH_BANDS, `${scope}__${name}`);
    });
}

export function openDepthCharts() {
    // Only the legacy collections, so a chart written by an older build can be
    // found and moved. A chart's own rows load on demand.
    return Promise.all([repository.ready(DEPTH_ROWS), repository.ready(DEPTH_BANDS)]);
}

export function hasChart(stage, seasonId) {
    migrateChart(stage, seasonId);
    return rowsOf(stage, seasonId).has(SCOPE);
}

/**
 * The chart in the shape every caller already reads:
 * `{ positionConfig: { offense, defense }, depthChart, reserve, cuts }`.
 */
export function readChart(stage, seasonId) {
    migrateChart(stage, seasonId);
    const all = rowsOf(stage, seasonId).read(SCOPE);

    const positionConfig = { offense: [], defense: [] };
    const depthChart = {};
    all.forEach(({ id, label, slots53, phase, slots }) => {
        depthChart[id] = slots;
        if (phase === 'offense' || phase === 'defense') {
            positionConfig[phase].push({ id, label, slots53 });
        }
    });

    const band = (name) => repository.get(bandsPath(stage, seasonId), name)?.slots ?? [];
    return { positionConfig, depthChart, reserve: band('reserve'), cuts: band('cuts') };
}

export function writeChart(stage, seasonId, state) {
    migrateChart(stage, seasonId);
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
                label: chip.label,
                slots53: chip.slots53,
                phase,
                slots: depthChart[chip.id] ?? [],
            });
        });
    });
    const configured = new Set(list.map(r => r.rowId));
    Object.keys(depthChart).forEach(rowId => {
        if (configured.has(rowId)) return;
        list.push({ rowId, label: rowId, slots53: 1, phase: null, slots: depthChart[rowId] ?? [] });
    });

    rowsOf(stage, seasonId).write(SCOPE, list);

    // A band document is its slots. It used to also carry `id`, `scope` and
    // `band` — the whole key, its left half, and its right half — which was
    // 111 of its 219 bytes spent restating where it is filed.
    const band = (name, slots) => {
        const path = bandsPath(stage, seasonId);
        const before = repository.get(path, name);
        const next = { slots: slots ?? [] };
        if (!before || JSON.stringify(before.slots ?? []) !== JSON.stringify(next.slots)) {
            repository.set(path, name, next);
        }
    };
    band('reserve', state.reserve);
    band('cuts', state.cuts);
}

export function removeChart(stage, seasonId) {
    migrateChart(stage, seasonId);
    return Promise.all([
        rowsOf(stage, seasonId).removeAll(SCOPE),
        repository.remove(bandsPath(stage, seasonId), 'reserve'),
        repository.remove(bandsPath(stage, seasonId), 'cuts'),
    ]);
}
