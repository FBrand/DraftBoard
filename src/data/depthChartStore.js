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

/** Nothing to open: a chart's rows load on demand, at its own path. */
export function openDepthCharts() {
    return Promise.resolve();
}

export function hasChart(stage, seasonId) {
    return rowsOf(stage, seasonId).has(SCOPE);
}

/**
 * The chart in the shape every caller already reads:
 * `{ positionConfig: { offense, defense }, depthChart, reserve, cuts }`.
 */
export function readChart(stage, seasonId) {
    const all = rowsOf(stage, seasonId).read(SCOPE);

    const positionConfig = { offense: [], defense: [] };
    const depthChart = {};
    all.forEach(({ id, label, slots53, phase, slots }) => {
        depthChart[id] = slots;
        if (phase === 'offense' || phase === 'defense') {
            positionConfig[phase].push({ id, label, slots53 });
        }
    });

    const band = (name) => fatSlots(repository.get(bandsPath(stage, seasonId), name)?.s);
    return { positionConfig, depthChart, reserve: band('reserve'), cuts: band('cuts') };
}

export function writeChart(stage, seasonId, state) {
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

    rowsOf(stage, seasonId).write(SCOPE, list);

    // A band document is its slots. It used to also carry `id`, `scope` and
    // `band` — the whole key, its left half, and its right half — which was
    // 111 of its 219 bytes spent restating where it is filed.
    const band = (name, slots) => {
        const path = bandsPath(stage, seasonId);
        const before = repository.get(path, name);
        const next = { s: leanSlots(slots) };
        if (!before || JSON.stringify(before.s ?? []) !== JSON.stringify(next.s)) {
            repository.set(path, name, next);
        }
    };
    band('reserve', state.reserve);
    band('cuts', state.cuts);
}

export function removeChart(stage, seasonId) {
    return Promise.all([
        rowsOf(stage, seasonId).removeAll(SCOPE),
        repository.remove(bandsPath(stage, seasonId), 'reserve'),
        repository.remove(bandsPath(stage, seasonId), 'cuts'),
    ]);
}
