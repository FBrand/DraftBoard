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

export const DEPTH_ROWS = 'depth_rows';
export const DEPTH_BANDS = 'depth_bands';

/** Which chart a row belongs to: one stage, one season. */
export const chartScope = (stage, seasonId) => `${seasonId ?? '_'}__${stage}`;

const rows = createDocSet({
    collection: DEPTH_ROWS,
    // rowId, not id: the item handed in is a row to be filed, and `id` is
    // what it will be filed AS. Reading the wrong one gave every row the same
    // document and the chart collapsed to whichever row was written last.
    idOf: (scope, row) => `${scope}__${row.rowId}`,
    strip: (doc) => ({
        id: doc.rowId,
        label: doc.label,
        slots53: doc.slots53,
        phase: doc.phase,
        slots: doc.slots ?? [],
    }),
});

export function openDepthCharts() {
    return Promise.all([repository.ready(DEPTH_ROWS), repository.ready(DEPTH_BANDS)]);
}

export function hasChart(stage, seasonId) {
    return rows.has(chartScope(stage, seasonId));
}

/**
 * The chart in the shape every caller already reads:
 * `{ positionConfig: { offense, defense }, depthChart, reserve, cuts }`.
 */
export function readChart(stage, seasonId) {
    const scope = chartScope(stage, seasonId);
    const all = rows.read(scope);

    const positionConfig = { offense: [], defense: [] };
    const depthChart = {};
    all.forEach(({ id, label, slots53, phase, slots }) => {
        depthChart[id] = slots;
        if (phase === 'offense' || phase === 'defense') {
            positionConfig[phase].push({ id, label, slots53 });
        }
    });

    const band = (name) => repository.get(DEPTH_BANDS, `${scope}__${name}`)?.slots ?? [];
    return { positionConfig, depthChart, reserve: band('reserve'), cuts: band('cuts') };
}

export function writeChart(stage, seasonId, state) {
    const scope = chartScope(stage, seasonId);
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

    rows.write(scope, list);

    // A band document is its slots. It used to also carry `id`, `scope` and
    // `band` — the whole key, its left half, and its right half — which was
    // 111 of its 219 bytes spent restating where it is filed.
    const band = (name, slots) => {
        const id = `${scope}__${name}`;
        const before = repository.get(DEPTH_BANDS, id);
        const next = { slots: slots ?? [] };
        if (!before || JSON.stringify(before.slots ?? []) !== JSON.stringify(next.slots)) {
            repository.set(DEPTH_BANDS, id, next);
        }
    };
    band('reserve', state.reserve);
    band('cuts', state.cuts);
}

export function removeChart(stage, seasonId) {
    const scope = chartScope(stage, seasonId);
    return Promise.all([
        rows.removeAll(scope),
        repository.remove(DEPTH_BANDS, `${scope}__reserve`),
        repository.remove(DEPTH_BANDS, `${scope}__cuts`),
    ]);
}
