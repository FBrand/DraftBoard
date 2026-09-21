import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * auth.js's own state machine, without Firebase.
 *
 * `tests/rules/rules.test.js` proves what Firestore PERMITS; nothing proved
 * what this module does with a permit request that errors instead of
 * answering — which is exactly where the "unconfirmed, not demoted" fix
 * lives (see auth.js's startAuth() catch block). Faked the SDK the same way
 * firebaseAdapter.test.js does: real logic, no real project.
 *
 * Boot is deliberately trivial (anonymous, no allowed_users branching) in
 * every test — the interesting transition under test happens as its own
 * explicit fireAuthChange() call afterward, not tangled into startAuth()'s
 * own one-shot-listener wait. Firebase's real listener callback can also
 * fire again from INSIDE signOut()/signInAnonymously() completing, and this
 * fake models that the same way (fireAuthChange re-enters listeners
 * synchronously) — keeping boot() itself free of that avoids a reentrant
 * mock timing trap that has nothing to do with the code under test.
 */

const FAKE_AUTH = {};
let listeners = [];
let allowedResult; // 'yes' | 'no' | Error

// Real Firebase Auth tracks auth.currentUser itself, and startAuth()'s own
// fallback (`if (!auth.currentUser) signInAnonymously()`) reads it.
function fireAuthChange(user) {
    FAKE_AUTH.currentUser = user;
    return Promise.all(listeners.map(fn => fn(user)));
}

function makeUser({ anonymous = false, email = 'dan@example.com', uid = 'u1' } = {}) {
    return {
        uid,
        isAnonymous: anonymous,
        email: anonymous ? null : email,
        displayName: anonymous ? null : 'Dan',
        providerData: anonymous ? [] : [{ providerId: 'google.com' }],
    };
}

vi.mock('../../src/data/firebaseApp', () => ({
    connect: async () => ({ auth: FAKE_AUTH, firestore: {} }),
}));

vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth, cb) => {
        listeners.push(cb);
        return () => { listeners = listeners.filter(fn => fn !== cb); };
    },
    signOut: vi.fn(async () => { await fireAuthChange(null); }),
    signInAnonymously: vi.fn(async () => { await fireAuthChange(makeUser({ anonymous: true })); }),
    signInWithPopup: vi.fn(async () => {
        const user = makeUser();
        FAKE_AUTH.currentUser = user;
        return { user };
    }),
    GoogleAuthProvider: class {},
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db, _collection, id) => ({ id }),
    getDoc: async ({ id }) => {
        if (allowedResult instanceof Error) throw allowedResult;
        // allowedUserState() (auth.js) reads both exists() and data() — the
        // active-flag work added data().active, and a mock missing it made
        // every check throw (calling undefined as a function), which this
        // file's own recheckAccess() catch swallowed into a misleading
        // "could not verify" error instead of the real cause.
        const found = allowedResult === 'yes' && id === 'dan@example.com';
        return { exists: () => found, data: () => (found ? { active: true } : undefined) };
    },
}));

/** Boot with a trivial anonymous session — no branching, no reentrancy risk. */
async function bootAnonymous() {
    const auth = await import('../../src/utils/auth');
    const p = auth.startAuth();
    await vi.waitFor(() => expect(listeners.length).toBeGreaterThanOrEqual(2));
    await fireAuthChange(makeUser({ anonymous: true }));
    await p;
    return auth;
}

describe('auth.js state machine', () => {
    // Whichever test runs first in this file pays a one-off cost (module
    // graph / dynamic-import warmup, not application logic) that pushes it
    // past the default timeout on its own. Absorb it here instead of
    // wherever happens to end up first.
    beforeAll(async () => {
        await bootAnonymous();
        vi.resetModules();
        listeners = [];
    }, 15000);

    beforeEach(() => {
        vi.resetModules();
        listeners = [];
        allowedResult = 'yes';
        vi.clearAllMocks();
    });

    it('a check that errors keeps the session and marks it unconfirmed, not demoted', async () => {
        const auth = await bootAnonymous();
        const fb = await import('firebase/auth');
        fb.signOut.mockClear();

        allowedResult = new Error('offline');
        await fireAuthChange(makeUser());

        expect(auth.isExpert()).toBe(false);
        expect(auth.currentUser().unconfirmed).toBe(true);
        expect(auth.currentUser().isAnonymous).toBe(false);
        expect(fb.signOut).not.toHaveBeenCalled();
    });

    it('recheckAccess() resolves an unconfirmed session once the check succeeds', async () => {
        const auth = await bootAnonymous();
        allowedResult = new Error('offline');
        await fireAuthChange(makeUser());
        expect(auth.currentUser().unconfirmed).toBe(true);

        allowedResult = 'yes';
        await auth.recheckAccess();
        expect(auth.isExpert()).toBe(true);
        expect(auth.currentUser().unconfirmed).toBe(false);
    });

    it('recheckAccess() demotes on a confirmed rejection', async () => {
        const auth = await bootAnonymous();
        allowedResult = new Error('offline');
        await fireAuthChange(makeUser());
        expect(auth.currentUser().unconfirmed).toBe(true);

        const fb = await import('firebase/auth');
        allowedResult = 'no';
        await expect(auth.recheckAccess()).rejects.toThrow(/not on the allowed experts list/);
        expect(fb.signOut).toHaveBeenCalledTimes(1);
        expect(auth.isExpert()).toBe(false);
    });

    it("demoteToViewer's in-flight guard collapses two concurrent demotions into one", async () => {
        const auth = await bootAnonymous();
        allowedResult = new Error('offline');
        await fireAuthChange(makeUser());
        expect(auth.currentUser().unconfirmed).toBe(true);

        const fb = await import('firebase/auth');
        allowedResult = 'no';
        await Promise.all([
            auth.recheckAccess().catch(() => {}),
            auth.recheckAccess().catch(() => {}),
        ]);
        expect(fb.signOut).toHaveBeenCalledTimes(1);
        expect(fb.signInAnonymously).toHaveBeenCalledTimes(1);
    });
});
