/**
 * Who is using the app, and what that entitles them to.
 *
 * Two kinds of person, and they are deliberately not two kinds of account:
 *
 *   An **expert** signs in with a real credential. He writes his own boards
 *   and the seasons they belong to. There are about ten of them.
 *
 *   A **viewer** is signed in anonymously. He gets a uid, so the app can tell
 *   him from the next viewer and keep his play-along separate, and he gets no
 *   write access to the shared database at all. His own mock lives in his own
 *   browser.
 *
 * The anonymous sign-in is worth explaining, because "signed in with no
 * account" reads like a contradiction. It buys one thing: a stable identity
 * for the session without asking anybody to register. What it does NOT buy is
 * permission — `firestore.rules` tests the sign-in provider, so an anonymous
 * uid is refused every write. That is the asymmetry the user asked for, and
 * the reason it lives in the rules rather than here: anything the browser
 * decides, the browser can be made to decide differently.
 *
 * `permissions.js` is told who is signed in so `canEdit()` can stop offering
 * controls that would be refused. That is a courtesy to the user, not a
 * security boundary — see the note at the top of the rules.
 */
import { setCurrentUser } from './permissions';

let auth = null;
let current = null;
const listeners = new Set();

function announce() {
    // permissions.js is the app's own answer to "may this change". Auth feeds
    // it rather than being consulted separately, so there is one place that
    // decides and one place to look when it decides wrongly.
    setCurrentUser(current);
    listeners.forEach(fn => fn(current));
}

/** Notified whenever the signed-in user changes. Returns an unsubscribe. */
export function onAuthChange(fn) {
    listeners.add(fn);
    fn(current);
    return () => listeners.delete(fn);
}

export function currentUser() {
    return current;
}

/**
 * True for somebody whose writes the database will actually accept.
 *
 * Anonymous is signed in and is still not an expert, which is the distinction
 * every caller actually wants — `isSignedIn()` alone would answer yes for a
 * viewer and send him to a control that fails.
 */
export function isExpert() {
    return !!current && current.provider !== 'anonymous';
}

function shape(user) {
    if (!user) return null;
    const provider = user.isAnonymous
        ? 'anonymous'
        : (user.providerData?.[0]?.providerId ?? 'unknown');
    return {
        id: user.uid,
        name: user.displayName || user.email || 'Signed in',
        email: user.email ?? null,
        provider,
        isAnonymous: !!user.isAnonymous,
    };
}

/**
 * Starts watching who is signed in, and signs a viewer in anonymously if
 * nobody is.
 *
 * Called once at startup by a Firebase build. A local build never calls it and
 * never imports the SDK — the app has to keep working with no backend at all,
 * which is what every viewer building a private mock is doing.
 */
export async function startAuth() {
    const { connect } = await import('../data/firebaseApp');
    const [{ auth: handle }, fb] = await Promise.all([connect(), import('firebase/auth')]);
    auth = handle;

    fb.onAuthStateChanged(auth, (user) => {
        current = shape(user);
        announce();
    });

    // Wait for the session Firebase already has before deciding there isn't
    // one.
    //
    // `auth.currentUser` is null for a moment after getAuth() whether or not
    // anybody is signed in: the persisted session lives in IndexedDB and is
    // restored asynchronously. Reading it straight away therefore said 'nobody'
    // for an expert who was signed in perfectly well — and the anonymous
    // sign-in below then REPLACED his session with a viewer's. He signed in,
    // reloaded the page, and was quietly demoted, every time, with his own
    // board suddenly read-only and his writes going to localStorage.
    //
    // The first callback fires once the restore has been attempted, with the
    // user or with null, which is the question actually being asked.
    await new Promise((resolve) => {
        const stop = fb.onAuthStateChanged(auth, () => { stop(); resolve(); });
    });

    // A viewer arrives with no session. Giving him an anonymous one costs
    // nothing and means his own state has somewhere to hang; it grants no
    // write access, which the rules enforce rather than trusting this.
    if (!auth.currentUser) {
        try {
            await fb.signInAnonymously(auth);
        } catch (err) {
            // Anonymous auth can be switched off for a project. That is not
            // fatal — the app still reads, which is most of what a viewer
            // does — so it is reported and not thrown.
            console.warn('Anonymous sign-in refused; continuing as a reader.', err?.code ?? err);
        }
    }
    return current;
}

/** Signs an expert in. The popup is deliberate: no password lives in this app. */
export async function signInExpert() {
    const fb = await import('firebase/auth');
    if (!auth) await startAuth();
    const provider = new fb.GoogleAuthProvider();
    const result = await fb.signInWithPopup(auth, provider);
    current = shape(result.user);
    announce();
    return current;
}

/**
 * Signs out, and comes straight back as a viewer.
 *
 * Signing out into no session at all would leave the app unable to read, which
 * is worse than what the user asked for — they wanted to stop being an author,
 * not to stop watching.
 */
export async function signOutExpert() {
    const fb = await import('firebase/auth');
    if (!auth) return null;
    await fb.signOut(auth);
    try {
        await fb.signInAnonymously(auth);
    } catch { /* reading without a session still works */ }
    return current;
}
