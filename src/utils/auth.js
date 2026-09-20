/**
 * Who is using the app, and what that entitles them to.
 *
 * Two kinds of person, and they are deliberately not two kinds of account:
 *
 *   An **expert** signs in with a real credential AND is on the allowed_users
 *   list (see firestore.rules) — signing in with Google alone is not enough,
 *   because the Firebase config shipped in the bundle is public by design and
 *   an unrestricted "any Google account" rule would let a stranger publish
 *   over a shared board. There are about ten experts.
 *
 *   A **viewer** is signed in anonymously. He gets a uid, so the app can tell
 *   him from the next viewer and keep his play-along separate, and he gets no
 *   write access to the shared database at all. His own mock lives in his own
 *   browser.
 *
 * The anonymous sign-in is worth explaining, because "signed in with no
 * account" reads like a contradiction. It buys one thing: a stable identity
 * for the session without asking anybody to register. What it does NOT buy is
 * permission — `firestore.rules` tests the sign-in provider, the verified
 * email and the allowed_users list, so an anonymous uid is refused every
 * write. That is the asymmetry the user asked for, and the reason it lives in
 * the rules rather than here: anything the browser decides, the browser can
 * be made to decide differently.
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
 * viewer and send him to a control that fails. Being on Google alone is not
 * enough either now — `isAllowed` is only ever set true once the allowed_users
 * check has actually succeeded (see shape() and the listener below), so this
 * single flag is where "is he really an expert" is decided everywhere in the
 * app, matching what firestore.rules itself requires.
 */
export function isExpert() {
    return !!current && current.isAllowed === true;
}

function shape(user, isAllowed = false, unconfirmed = false) {
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
        isAllowed: !user.isAnonymous && isAllowed,
        // A real Google session whose allowed_users check errored rather than
        // returning a definitive answer — distinct from "confirmed not
        // allowed" so the UI can say so instead of showing a bare "Sign in"
        // that looks identical to never having signed in at all. See the
        // catch block below, and recheckAccess().
        unconfirmed: !user.isAnonymous && !isAllowed && unconfirmed,
    };
}

/**
 * Whether an email is on the allowed_users list — a DEFINITIVE answer.
 *
 * Resolves true/false only once Firestore has actually answered. On anything
 * else — offline, a blocked request, the rules not deployed yet — this
 * THROWS rather than returning false, so a caller can tell "confirmed not
 * allowed" apart from "could not check". Collapsing those two into one false
 * is exactly the shape of the bug documented below in startAuth(): a
 * perfectly good expert would be judged not-allowed on a network hiccup and
 * demoted.
 */
export async function isEmailAllowed(email) {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    const { connect } = await import('../data/firebaseApp');
    const [{ firestore }, { doc, getDoc }] = await Promise.all([
        connect(),
        import('firebase/firestore'),
    ]);
    const snap = await getDoc(doc(firestore, 'allowed_users', normalized));
    return snap.exists();
}

/** Every allowed_users entry — only reachable once the caller is one. */
export async function listAllowedExperts() {
    const { connect } = await import('../data/firebaseApp');
    const [{ firestore }, { collection, getDocs }] = await Promise.all([
        connect(),
        import('firebase/firestore'),
    ]);
    const snap = await getDocs(collection(firestore, 'allowed_users'));
    const list = [];
    snap.forEach(d => {
        const data = d.data() || {};
        list.push({
            email: d.id,
            addedBy: data.addedBy ?? null,
            addedAt: data.addedAt ?? null,
        });
    });
    return list.sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Adds an expert. firestore.rules requires the caller to already be one, and
 * requires addedBy to be the caller's own email — this is a courtesy error
 * message for the common failure, not the actual security boundary.
 */
export async function addAllowedExpert(email) {
    if (!email || !email.includes('@')) {
        throw new Error('Please provide a valid email address.');
    }
    const normalized = email.trim().toLowerCase();
    const { connect } = await import('../data/firebaseApp');
    const [{ firestore }, { doc, setDoc }] = await Promise.all([
        connect(),
        import('firebase/firestore'),
    ]);
    const record = {
        email: normalized,
        addedBy: current?.email?.toLowerCase() || current?.email || 'an expert',
        addedAt: new Date().toISOString(),
    };
    await setDoc(doc(firestore, 'allowed_users', normalized), record);
    return record;
}

/**
 * Signs out and back in anonymously — used whenever a session turns out not
 * to belong to an allowed expert. A single in-flight guard, because both the
 * auth-state listener and a rejected signInExpert() can reach this at once
 * (a fresh Google sign-in fires the listener too), and running the
 * sign-out/sign-in-anonymously pair twice concurrently is a race worth not
 * having rather than a race worth debugging later.
 */
let demoting = null;
async function demoteToViewer(fb) {
    if (demoting) return demoting;
    demoting = (async () => {
        try {
            await fb.signOut(auth);
            await fb.signInAnonymously(auth);
        } catch { /* reading without a session still works */ }
    })().finally(() => { demoting = null; });
    return demoting;
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

    fb.onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
            let allowed;
            try {
                allowed = await isEmailAllowed(user.email);
            } catch (err) {
                // Could not confirm either way — offline, a blocked request,
                // or allowed_users unreachable. NOT the same as "confirmed
                // not allowed", and treating it as one is the bug this
                // project already shipped once (see the restore note below):
                // an expert would be signed out and silently demoted, and
                // because a local write wins on read (overlayAdapter.js),
                // every edit he makes afterward becomes a shadow copy that
                // never reaches the shared board. Keep the real session,
                // report him as not-yet-confirmed rather than not-allowed,
                // and let a later check — the next sign-in attempt, or this
                // listener firing again — resolve it for real.
                console.warn(`Could not confirm ${user.email} against allowed_users; keeping the session as not-yet-confirmed.`, err?.code ?? err);
                current = shape(user, current?.isAllowed ?? false, true);
                announce();
                return;
            }
            if (!allowed) {
                console.warn(`${user.email} is not on the allowed experts list; continuing as a viewer.`);
                await demoteToViewer(fb);
                return;
            }
            current = shape(user, true);
        } else {
            current = shape(user, false);
        }
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

/**
 * Signs an expert in. The popup is deliberate: no password lives in this app.
 *
 * Checks the allowed_users list itself, on top of the auth-state listener
 * above, so the person actually clicking the button gets a specific answer
 * in the same promise ("you're not on the list") rather than waiting for the
 * listener to demote him and having the UI merely notice he reverted to a
 * viewer with no explanation.
 */
export async function signInExpert() {
    const fb = await import('firebase/auth');
    if (!auth) await startAuth();
    const provider = new fb.GoogleAuthProvider();
    const result = await fb.signInWithPopup(auth, provider);
    const user = result.user;
    const email = user?.email;

    if (!email) {
        await demoteToViewer(fb);
        throw new Error('Sign-in provider did not provide an email address.');
    }

    let allowed;
    try {
        allowed = await isEmailAllowed(email);
    } catch (err) {
        // Leave the real Google session in place — the listener above will
        // retry the same check independently — rather than guessing either
        // way from a failed lookup.
        throw new Error('Could not verify your access right now. Try again in a moment.');
    }
    if (!allowed) {
        await demoteToViewer(fb);
        throw new Error(`Access restricted: "${email}" is not on the allowed experts list.`);
    }

    current = shape(user, true);
    announce();
    return current;
}

/**
 * Re-runs the allowed_users check for whoever Firebase already has signed
 * in, without a popup — the recovery action for `unconfirmed` (a real Google
 * session that couldn't be checked yet). No-op for a viewer or nobody.
 */
export async function recheckAccess() {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) return current;
    const user = auth.currentUser;

    let allowed;
    try {
        allowed = await isEmailAllowed(user.email);
    } catch {
        throw new Error('Could not verify your access right now. Try again in a moment.');
    }
    if (!allowed) {
        const fb = await import('firebase/auth');
        await demoteToViewer(fb);
        throw new Error(`Access restricted: "${user.email}" is not on the allowed experts list.`);
    }

    current = shape(user, true);
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
