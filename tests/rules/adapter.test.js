import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';

import { BATCH_LIMIT } from '../../src/data/firebaseAdapter';
import { playerFields, entryFields, rowFields, slotFields } from '../../src/data/fieldNames';

/**
 * The Firestore adapter, against Firestore.
 *
 * `firebaseAdapter.test.js` runs it against a fake and proves the adapter's own
 * logic — path validation, batching, deletion. What a fake cannot prove is
 * whether Firestore ACCEPTS what the app writes, and that turned out to matter:
 * a remark had become `[text, writtenAt]` inside an array, which is the
 * cheapest shape there is and which Firestore refuses outright — "Nested arrays
 * are not supported". No unit test could have found it.
 *
 * So this writes the real document shapes, every one of them, and reads them
 * back. It is the only thing standing between a schema decision and finding out
 * on deploy.
 */
const PROJECT = 'demo-adapter';

let env;
let store;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: { host: '127.0.0.1', port: 8080, rules: 'rules_version = "2";\nservice cloud.firestore { match /databases/{db}/documents { match /{d=**} { allow read, write: if true; } } }' },
    });
});

afterAll(async () => { await env?.cleanup(); });

/**
 * Rules are OFF here on purpose. What is under test is whether Firestore will
 * hold the shapes the app writes — rules.test.js is where who-may-write lives,
 * and mixing the two would mean a shape failure looking like a permission one.
 */
beforeEach(async () => {
    await env.clearFirestore();
    // An ordinary context, not withSecurityRulesDisabled — that one tears its
    // client down when the callback returns, and every later call fails with
    // "The client has already been terminated". This project's rules are open,
    // so an ordinary context is enough.
    {
        const db = env.authenticatedContext('anyone').firestore();
        store = {
            async load(path) {
                const snap = await getDocs(collection(db, path));
                const out = {};
                snap.forEach(d => { out[d.id] = d.data(); });
                return out;
            },
            async commit(path, changes) {
                for (let i = 0; i < changes.length; i += BATCH_LIMIT) {
                    const batch = writeBatch(db);
                    changes.slice(i, i + BATCH_LIMIT).forEach(({ id, doc: d }) => {
                        const ref = doc(db, path, id);
                        if (d === null) batch.delete(ref);
                        else batch.set(ref, d);
                    });
                    await batch.commit();
                }
            },
        };
    }
});

describe('the shapes the app actually writes', () => {
    it('stores a player record as the registry leans it', async () => {
        const path = 'players';
        const lean = playerFields.lean({
            name: 'Tyquan Thornton', position: 'WR', school: 'Baylor',
            team: 'KC', draftYear: 2022, draftRound: 2, draftPick: 50,
            isUdfa: false, createdAt: 1789434931720, updatedAt: 1789434932965,
            aliases: [{ name: 'T Thornton', position: 'WR', school: 'Baylor' }],
        });

        await store.commit(path, [{ id: 'p_gblwjors', doc: lean }]);
        const back = await store.load(path);

        expect(playerFields.fat(back.p_gblwjors)).toMatchObject({
            name: 'Tyquan Thornton', draftPick: 50, isUdfa: false,
        });
        // An alias is an array of maps — allowed, unlike an array of arrays.
        expect(playerFields.fat(back.p_gblwjors).aliases[0].name).toBe('T Thornton');
    });

    it('stores a board entry under the board’s own path', async () => {
        const path = 'boards/b_x55j4htf/entries';
        const lean = entryFields.lean({ position: 'QB', round: 1, tier: 5, withinGroup: 1, updatedAt: 1 });

        await store.commit(path, [{ id: 'p_ldrp721j', doc: lean }]);
        const back = await store.load(path);

        expect(entryFields.fat(back.p_ldrp721j)).toEqual({
            position: 'QB', round: 1, tier: 5, withinGroup: 1, updatedAt: 1,
        });
    });

    it('stores a depth row, slots and empty slots included', async () => {
        const path = 'seasons/s_41cpnhxx/charts/rosterState/rows';
        // A null in the middle of a row is how the chart says "nobody here
        // yet" without closing the gap, so it has to survive the round trip.
        const slots = [
            slotFields.lean({ name: 'Tyquan Thornton', zone: '53' }),
            null,
            slotFields.lean({ name: 'Jason Brownlee', zone: 'r', arrival: 'FA' }),
        ];
        const lean = rowFields.lean({ label: 'WR.Z', slots53: 2, phase: 'offense', order: 0, slots });

        await store.commit(path, [{ id: 'O-WR.Z-0', doc: lean }]);
        const back = await store.load(path);
        const row = rowFields.fat(back['O-WR.Z-0']);

        expect(row.label).toBe('WR.Z');
        expect(row.slots).toHaveLength(3);
        expect(row.slots[1]).toBeNull();
        expect(slotFields.fat(row.slots[2]).arrival).toBe('FA');
    });

    it('stores a remark — a map in an array, which is the shape that works', async () => {
        const path = 'evaluations/p_a11989cf/remarks';
        const doc1 = {
            s_1e66044d: {
                s: [{ t: 'Natural thrower and a pro-ready timing quarterback', a: 1789418428790 }],
                n: [{ t: 'Compares to Quinyon Mitchell', a: 1789418428791 }],
            },
        };

        await store.commit(path, [{ id: 'b_9f9330c8', doc: doc1 }]);
        const back = await store.load(path);

        expect(back.b_9f9330c8.s_1e66044d.s[0].t).toBe('Natural thrower and a pro-ready timing quarterback');
        expect(back.b_9f9330c8.s_1e66044d.n).toHaveLength(1);
    });

    it('refuses a nested array, which is why a remark is not a tuple', async () => {
        // The bug this file exists for. `[["text", 1]]` is smaller than
        // `[{t:"text",a:1}]` and Firestore will not take it.
        const path = 'evaluations/p_nested/remarks';
        await expect(
            store.commit(path, [{ id: 'b_1', doc: { s_1: { s: [['text', 1]] } } }]),
        ).rejects.toThrow(/[Nn]ested arrays/);
    });
});

describe('batching, against the real limit', () => {
    it('writes more documents than one batch holds', async () => {
        // Seeding the registry is 733 documents; Firestore commits 500 at once
        // and rejects the 501st.
        const path = 'players';
        const changes = Array.from({ length: 733 }, (_, i) => ({
            id: `p_${String(i).padStart(8, '0')}`,
            doc: playerFields.lean({ name: `Player ${i}`, position: 'WR' }),
        }));

        await store.commit(path, changes);
        expect(Object.keys(await store.load(path))).toHaveLength(733);
    }, 60_000);
});

describe('deletion', () => {
    it('treats doc:null as a deletion rather than an empty document', async () => {
        const path = 'players';
        await store.commit(path, [{ id: 'p_1', doc: { n: 'One' } }, { id: 'p_2', doc: { n: 'Two' } }]);
        await store.commit(path, [{ id: 'p_1', doc: null }]);

        const back = await store.load(path);
        expect(back.p_1).toBeUndefined();
        expect(back.p_2.n).toBe('Two');
    });
});
