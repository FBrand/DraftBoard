import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createFirebaseAdapter, isCollectionPath, chunk, BATCH_LIMIT,
} from '../../src/data/firebaseAdapter';
import { firebaseConfig, isConfigured } from '../../src/data/firebaseApp';

/**
 * The Firestore adapter, without Firestore.
 *
 * There is no emulator on this machine and no project to point at, so the SDK
 * is faked. That is a real limit and worth stating: this proves the adapter's
 * own logic — path validation, batching, deletion, the shape it returns — and
 * proves nothing about whether Firestore accepts the calls. The parts a fake
 * cannot check are the rules and the wire, and those need a project.
 *
 * What it does check is the set of things that would otherwise be found by
 * deploying: that 733 documents do not go into one 500-write batch, that
 * `doc: null` deletes rather than writing an empty document, and that a
 * document path is refused before the SDK reports it as a type error three
 * frames away.
 */
const store = new Map();
const batches = [];

vi.mock('firebase/firestore', () => {
    const key = (path, id) => `${path} ${id}`;
    return {
        collection: (_db, path) => ({ path }),
        doc: (_db, path, id) => ({ path, id }),
        getDocs: async ({ path }) => {
            const rows = [...store.entries()]
                .filter(([k]) => k.startsWith(`${path} `))
                .map(([k, v]) => ({ id: k.split(' ')[1], data: () => v }));
            return { forEach: (fn) => rows.forEach(fn) };
        },
        setDoc: async ({ path, id }, data) => { store.set(key(path, id), data); },
        deleteDoc: async ({ path, id }) => { store.delete(key(path, id)); },
        writeBatch: () => {
            const ops = [];
            return {
                set: (ref, data) => ops.push(['set', ref, data]),
                delete: (ref) => ops.push(['delete', ref]),
                commit: async () => {
                    batches.push(ops.length);
                    ops.forEach(([kind, ref, data]) => {
                        if (kind === 'set') store.set(key(ref.path, ref.id), data);
                        else store.delete(key(ref.path, ref.id));
                    });
                },
            };
        },
    };
});

vi.mock('../../src/data/firebaseApp', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, connect: async () => ({ app: {}, firestore: {}, auth: {} }) };
});

let adapter;
beforeEach(() => {
    store.clear();
    batches.length = 0;
    adapter = createFirebaseAdapter();
});

describe('what counts as a collection', () => {
    it('accepts an odd number of segments, which is what Firestore calls a collection', () => {
        expect(isCollectionPath('players')).toBe(true);
        expect(isCollectionPath('boards/b1/entries')).toBe(true);
        expect(isCollectionPath('seasons/s1/charts/rosterState/rows')).toBe(true);
    });

    it('rejects an even number, because that addresses a document', () => {
        expect(isCollectionPath('boards/b1')).toBe(false);
        expect(isCollectionPath('')).toBe(false);
    });

    it('refuses a document path with a message about the actual mistake', async () => {
        await expect(adapter.load('boards/b1')).rejects.toThrow(/not a collection path/);
        await expect(adapter.set('boards/b1', 'x', {})).rejects.toThrow(/odd number of segments/);
    });
});

describe('reading and writing one document', () => {
    it('round-trips, keyed by id, with the id not in the document', async () => {
        await adapter.set('players', 'p_mendoza', { name: 'Fernando Mendoza', position: 'QB' });
        const docs = await adapter.load('players');

        expect(Object.keys(docs)).toEqual(['p_mendoza']);
        expect(docs.p_mendoza).toEqual({ name: 'Fernando Mendoza', position: 'QB' });
        expect(docs.p_mendoza.id).toBeUndefined();
    });

    it('keeps one board entries out of another, which is the point of the path', async () => {
        await adapter.set('boards/b1/entries', 'p_mendoza', { round: 1 });
        await adapter.set('boards/b2/entries', 'p_mendoza', { round: 4 });

        expect((await adapter.load('boards/b1/entries')).p_mendoza.round).toBe(1);
        expect((await adapter.load('boards/b2/entries')).p_mendoza.round).toBe(4);
    });

    it('removes', async () => {
        await adapter.set('players', 'p1', { name: 'One' });
        await adapter.remove('players', 'p1');
        expect(await adapter.load('players')).toEqual({});
    });
});

describe('committing a batch', () => {
    it('treats doc:null as a deletion, not as an empty document', async () => {
        await adapter.set('players', 'p1', { name: 'One' });
        await adapter.commit('players', [{ id: 'p1', doc: null }, { id: 'p2', doc: { name: 'Two' } }]);

        const docs = await adapter.load('players');
        expect(docs.p1).toBeUndefined();
        expect(docs.p2).toEqual({ name: 'Two' });
    });

    it('splits past the 500-write limit instead of failing at 501', async () => {
        // Seeding the registry is 733 documents and seeding a board is 328.
        // One batch would be rejected outright.
        const changes = Array.from({ length: 733 }, (_, i) => ({ id: `p${i}`, doc: { n: i } }));
        await adapter.commit('players', changes);

        expect(batches).toEqual([BATCH_LIMIT, 233]);
        expect(Object.keys(await adapter.load('players'))).toHaveLength(733);
    });

    it('does nothing at all for no changes', async () => {
        await adapter.commit('players', []);
        expect(batches).toEqual([]);
    });
});

describe('clearing a collection', () => {
    it('deletes its documents, because a collection is nothing else', async () => {
        await adapter.commit('players', [{ id: 'a', doc: {} }, { id: 'b', doc: {} }]);
        await adapter.clear('players');
        expect(await adapter.load('players')).toEqual({});
    });
});

describe('the one deliberate omission', () => {
    it('has no loadSync, which is what forces callers onto ready()', () => {
        // Every synchronous read in the app is served by localStorage
        // answering instantly. No network can. Its absence is the feature.
        expect(adapter.loadSync).toBeUndefined();
    });
});

describe('configuration', () => {
    it('is not ok until every required field is present', () => {
        expect(isConfigured({})).toBe(false);
        expect(firebaseConfig({ VITE_FIREBASE_API_KEY: 'k' }).missing)
            .toEqual(['authDomain', 'projectId', 'appId']);
    });

    it('is ok with the four that matter, bucket and sender being optional', () => {
        const env = {
            VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'd',
            VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_APP_ID: 'a',
        };
        expect(isConfigured(env)).toBe(true);
        expect(firebaseConfig(env).config.projectId).toBe('p');
    });
});

describe('chunking', () => {
    it('leaves a short list alone and never returns an empty tail', () => {
        expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
        expect(chunk([], 5)).toEqual([]);
        expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    });
});
