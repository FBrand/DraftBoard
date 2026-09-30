/**
 * A stable fingerprint of a seed snapshot, for comparing two runs.
 *
 * Document ids are generated, so two runs of the seeder are never byte-identical
 * and a diff says nothing. This reduces a snapshot to what should NOT change when
 * seeding logic is moved from the app into the seeder: how many documents each
 * collection holds, and the content that is actually about the draft class rather
 * than about where it was filed.
 *
 *   node scripts/snapshot-fingerprint.mjs a.json [b.json]
 *
 * With two arguments it reports the differences and exits non-zero if there are
 * any, which is the form the extraction is verified with.
 */
import { readFileSync } from 'node:fs';

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Collection names with their generated ids replaced by a shape. */
const family = (collection) => collection
    .replace(/\/[a-z]_[a-z0-9]+\//g, '/*/')
    .replace(/\/[a-z]_[a-z0-9]+$/, '/*')
    .replace(/scopes\/[^/]+/, 'scopes/*');

export function fingerprint(snapshot) {
    const counts = {};
    const players = [];
    const boards = [];
    const remarks = [];

    Object.entries(snapshot.collections ?? {}).forEach(([collection, docs]) => {
        const key = family(collection);
        const ids = Object.keys(docs ?? {});
        counts[key] = (counts[key] ?? 0) + ids.length;

        if (key === 'players') ids.forEach(id => players.push(`${docs[id].n}|${docs[id].p ?? ''}|${docs[id].s ?? ''}`));
        if (key === 'boards') ids.forEach(id => boards.push(`${docs[id].g}|${docs[id].l}|${docs[id].a ? 'authored' : 'shared'}`));
        if (key === 'evaluations/*/remarks') {
            ids.forEach(id => Object.values(docs[id] ?? {}).forEach(kinds => {
                Object.values(kinds ?? {}).forEach(line => (line ?? []).forEach(r => remarks.push(r.t)));
            }));
        }
    });

    return {
        documents: snapshot.documents ?? null,
        year: snapshot.season?.year ?? null,
        counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
        players: players.sort(),
        boards: boards.sort(),
        remarks: remarks.sort(),
    };
}

const [a, b] = process.argv.slice(2);
if (!a) {
    console.error('usage: snapshot-fingerprint.mjs <snapshot.json> [other.json]');
    process.exit(2);
}

const one = fingerprint(load(a));

if (!b) {
    console.log(JSON.stringify({ ...one, players: one.players.length, remarks: one.remarks.length, boards: one.boards }, null, 2));
    process.exit(0);
}

const two = fingerprint(load(b));
const problems = [];

if (one.documents !== two.documents) problems.push(`documents: ${one.documents} -> ${two.documents}`);
if (one.year !== two.year) problems.push(`season year: ${one.year} -> ${two.year}`);

new Set([...Object.keys(one.counts), ...Object.keys(two.counts)]).forEach((k) => {
    const x = one.counts[k] ?? 0;
    const y = two.counts[k] ?? 0;
    if (x !== y) problems.push(`${k}: ${x} -> ${y}`);
});

[['players', one.players, two.players], ['boards', one.boards, two.boards], ['remarks', one.remarks, two.remarks]]
    .forEach(([what, x, y]) => {
        const lost = x.filter(v => !y.includes(v));
        const gained = y.filter(v => !x.includes(v));
        if (lost.length) problems.push(`${what}: ${lost.length} lost, first: ${lost[0]}`);
        if (gained.length) problems.push(`${what}: ${gained.length} gained, first: ${gained[0]}`);
    });

if (!problems.length) {
    console.log(`Identical: ${one.documents} documents, ${one.players.length} players, ${one.remarks.length} remarks.`);
    process.exit(0);
}
console.error(`${problems.length} difference(s):`);
problems.forEach(p => console.error(`  ${p}`));
process.exit(1);
