/**
 * The Firebase connection, made once and only when something asks.
 *
 * Two things shape this file.
 *
 * **The config is not a secret, and is still not in the repository.** A web
 * app's Firebase config — apiKey included — ships to every browser that loads
 * the page; it identifies the project, it does not authorise anything. What
 * authorises is the security rules and the signed-in user. So the reason it
 * comes from the environment is not secrecy, it is that a fork or a second
 * deployment must not silently write into this project's database. The GitHub
 * Pages build injects it from repository secrets at build time.
 *
 * **It is lazy.** `createAdapter()` runs at module load, before anything knows
 * whether the app will talk to Firebase at all, and importing the SDK costs
 * both bytes and a network connection. Nothing here runs until the adapter
 * makes its first call.
 */
let app = null;
let firestore = null;
let auth = null;

/**
 * The connection being made, if one is already under way.
 *
 * The cached-handles check below cannot help a SECOND caller that arrives
 * while the first is still awaiting its imports — it sees the same nulls and
 * connects again. Everything downstream of that is idempotent except
 * connectFirestoreEmulator, which throws once Firestore has started, and the
 * throw comes back out of api() — so every read and write made through that
 * call fails. It showed up as '25 unsaved — retrying' the moment live
 * updates were added, because watching a collection is one more caller
 * racing the others at startup.
 */
let connecting = null;

/** The pieces of config that must all be present for a connection to work. */
const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

/**
 * Reads the config out of the build environment.
 *
 * Returns null rather than a half-filled object when anything is missing:
 * connecting with three of four fields fails later, somewhere less obvious,
 * with an error about the thing that happened to be asked for first.
 */
export function firebaseConfig(env = import.meta.env ?? {}) {
    const config = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
    };
    const missing = REQUIRED.filter(k => !String(config[k] ?? '').trim());
    if (missing.length) return { ok: false, missing, config: null };
    return { ok: true, missing: [], config };
}

/** Whether this build was given enough to talk to Firebase at all. */
export function isConfigured(env) {
    return firebaseConfig(env).ok;
}

/**
 * The initialised app, Firestore and Auth handles.
 *
 * Throws when the build has no config, and says which fields are missing —
 * the alternative is a connection that fails on its first read with a message
 * about permissions, which sends you looking in the rules for a problem that
 * is in an environment variable.
 */
export async function connect() {
    if (firestore && auth) return { app, firestore, auth };
    if (connecting) return connecting;

    connecting = openConnection();
    try {
        return await connecting;
    } catch (err) {
        // A failed connection must not be remembered, or the app can never
        // recover from a bad moment at startup.
        connecting = null;
        throw err;
    }
}

async function openConnection() {
    const { ok, missing, config } = firebaseConfig();
    if (!ok) {
        throw new Error(
            `Firebase is not configured: missing ${missing.map(m => `VITE_FIREBASE_${m.replace(/([A-Z])/g, '_$1').toUpperCase()}`).join(', ')}. `
            + 'Set them in the build environment, or use VITE_BACKEND=local.',
        );
    }

    const [{ initializeApp, getApps }, fs, fbAuth] = await Promise.all([
        import('firebase/app'),
        import('firebase/firestore'),
        import('firebase/auth'),
    ]);

    app = getApps()[0] ?? initializeApp(config);

    /**
     * A field set to undefined is dropped, rather than refused.
     *
     * This is the one setting that makes Firestore agree with the store the
     * app was written against. JSON.stringify drops an undefined value
     * silently, so localStorage has always accepted a row whose slots53 or
     * label happened to be undefined, and nothing ever had to care.
     * Firestore rejects the WHOLE BATCH for one such field:
     *
     *   invalid-argument: Unsupported field value: undefined
     *     (found in document seasons/{id}/charts/fa_state_v1/rows/...)
     *
     * and the repository, correctly, classifies that as permanent and stops
     * — so a single undefined in a depth-chart row took down every write an
     * expert made: 25 unsaved, retrying, none of them related to the row
     * that was actually malformed. Dropping it is what the other adapter
     * does, and parity between the two is the whole point of the seam.
     */
    firestore = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    auth = fbAuth.getAuth(app);

    // Point at the emulator when the build says to. This is how the app is
    // driven end to end without a real project — the adapter, the repository,
    // every store and every view against an actual Firestore rather than a
    // fake. It is a build-time flag rather than a runtime one so a deployed
    // build cannot be talked into it.
    const emulator = String(import.meta.env?.VITE_FIREBASE_EMULATOR ?? '').trim();
    if (emulator) {
        const [host, port] = emulator.split(':');
        fs.connectFirestoreEmulator(firestore, host, Number(port) || 8080);
        console.info(`Firestore: emulator at ${emulator}`);

        // Auth has to follow it. A build pointed at a local Firestore while
        // signing in against the real project would be asking the emulator to
        // trust a token minted somewhere else — and, more to the point, nobody
        // running the app locally has the real project's credentials.
        const authEmulator = String(import.meta.env?.VITE_FIREBASE_AUTH_EMULATOR ?? '').trim()
            || `${host}:9099`;
        try {
            fbAuth.connectAuthEmulator(auth, `http://${authEmulator}`, { disableWarnings: true });
            console.info(`Auth: emulator at ${authEmulator}`);
        } catch (err) {
            // Already connected, or no auth emulator running. Neither is fatal
            // — reads do not need a session.
            console.warn('Auth emulator not connected.', err?.message ?? err);
        }
    }

    return { app, firestore, auth };
}

/** Drops the connection. Tests use it; the app has no reason to. */
export function resetConnection() {
    app = null;
    firestore = null;
    auth = null;
    connecting = null;
}
