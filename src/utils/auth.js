/**
 * Who is using the app, and what that entitles them to.
 *
 * Two kinds of person, and they are deliberately not two kinds of account:
 *
 *   An **expert** signs in with a real credential AND has an `email2author`
 *   entry (see firestore.rules) — signing in with Google alone is not enough,
 *   because the Firebase config shipped in the bundle is public by design and
 *   an unrestricted "any Google account" rule would let a stranger publish
 *   over a shared board. There are about ten experts.
 *
 *   That entry is the ONE thing granting access, and its EXISTENCE is the
 *   whole of it — there is no active flag to read, and revoking is deleting
 *   it. It is keyed by email because it has to exist before its person does:
 *   an invite is written for somebody who has never signed in, so there is no
 *   uid to key it by yet. That is also what breaks the bootstrap circle —
 *   `authors/{uid}` cannot gate its own creation on already being an expert,
 *   so the invite, checked against an address the token carries from the very
 *   first request, gates it instead.
 *
 *   The author record itself is created here, at first sign-in, keyed by the
 *   uid. From that point "which author am I" is a fact the token already
 *   carries, which is why no rule in this app ever looks an author up.
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
 * email and the email2author invite, so an anonymous uid is refused every
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
 * The signed-in uid, which is also this person's AUTHOR id — the two are the
 * same string by construction. Handed to the adapter by `backend.js` so the
 * stores can ask who is acting without importing this module (and closing the
 * boardRegistry -> permissions -> auth cycle).
 */
export function currentUserId() {
    return current?.id ?? null;
}

/**
 * True for somebody whose writes the database will actually accept.
 *
 * Anonymous is signed in and is still not an expert, which is the distinction
 * every caller actually wants — `isSignedIn()` alone would answer yes for a
 * viewer and send him to a control that fails. Being on Google alone is not
 * enough either now — `isAllowed` is only ever set true once the email2author
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
        // A real Google session whose email2author check errored rather than
        // returning a definitive answer — distinct from "confirmed not
        // allowed" so the UI can say so instead of showing a bare "Sign in"
        // that looks identical to never having signed in at all. See the
        // catch block below, and recheckAccess().
        unconfirmed: !user.isAnonymous && !isAllowed && unconfirmed,
    };
}

const lower = (email) => String(email ?? '').trim().toLowerCase();

/** The Firestore handle and the few SDK functions this module writes with. */
async function store() {
    const { connect } = await import('../data/firebaseApp');
    const [{ firestore }, fs] = await Promise.all([
        connect(),
        import('firebase/firestore'),
    ]);
    return { db: firestore, ...fs };
}

/**
 * Whether this email has an `email2author` entry — a DEFINITIVE answer, or
 * an exception.
 *
 * It THROWS on anything that is not a real answer (offline, a blocked
 * request, the rules not deployed yet) rather than returning false. That
 * distinction is the whole point: collapsing "could not check" into "not
 * allowed" is a bug this project has already shipped once — see the note in
 * startAuth() — where a perfectly good expert was demoted by a network
 * hiccup and then wrote a session's worth of work into a local shadow copy
 * that never reached anybody.
 *
 * A single-document read, not a listing: the rules let any signed-in Google
 * user read HIS OWN entry, and nobody read the whole collection until he is
 * an expert himself.
 */
export async function isEmailInvited(email) {
    if (!email) return false;
    const { db, doc, getDoc } = await store();
    const snap = await getDoc(doc(db, 'email2author', lower(email)));
    return snap.exists();
}

/**
 * Makes sure this person has an author record, creating it on first sign-in.
 *
 * Keyed by the uid, which is what lets every ownership check in
 * firestore.rules be a comparison against the token rather than a lookup.
 * The invite is what permits the write — isExpert() asks about email2author
 * and nothing else, so it is already true here even though the author does
 * not exist yet. That ordering is the bootstrap: without it, creating an
 * author would require being an expert, and being an expert would require
 * an author.
 *
 * Never overwrites an existing record. A second sign-in is not a rename, and
 * a returning expert's own name is his to change, not this function's to
 * reset from whatever Google currently reports.
 */
async function ensureAuthorRecord(user) {
    const { db, doc, getDoc, setDoc } = await store();
    const ref = doc(db, 'authors', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
        n: user.displayName || user.email || 'Expert',
        e: lower(user.email),
        c: new Date().toISOString(),
    });
}

/**
 * The same thing, but insisted upon — and the reason it has to be insisted
 * upon is worth stating, because the obvious reading is that this is
 * belt-and-braces.
 *
 * An expert with no author record can still create boards: isExpert() asks
 * about the invite and nothing else, deliberately, because that ordering is
 * what breaks the bootstrap. So a board can end up owned by a uid that has
 * no author document — and THAT state is unrecoverable:
 *
 *   - ownerRevoked() finds no author, fails closed, reports "not revoked",
 *     so nobody can claim the board;
 *   - ownsBoardData needs o == your uid, so nobody else can write it;
 *   - if it is private, boardVisible needs the same, so nobody can read it;
 *   - authors is `delete: if false` and create demands the id be your OWN
 *     uid, so nobody can even write the missing record to undo it.
 *
 * Nothing short of the Firebase console gets that board back. The callers
 * below treat a failure here as non-fatal because a man with an invite IS an
 * expert and being unable to write his profile must not lock him out of the
 * app — which is right, but it means the app produces the stranding state on
 * its own, quietly, with no retry. Hence this: retry before anything that
 * could create a board, and let the caller decide whether to proceed.
 *
 * Returns true once the record exists. Retries are immediate rather than
 * backed off: the caller is a person waiting on a click, and three quick
 * attempts covers the transient case this is actually for.
 */
export async function ensureAuthorRecordNow(attempts = 3) {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) return false;
    for (let i = 0; i < attempts; i += 1) {
        try {
            await ensureAuthorRecord(auth.currentUser);
            return true;
        } catch (err) {
            if (i === attempts - 1) {
                console.warn('Could not create the author record.', err?.code ?? err);
                return false;
            }
        }
    }
    return false;
}

/**
 * Everyone who may act as an expert, plus everyone who has been invited and
 * never signed in.
 *
 * Two collections, because they answer two different questions and only one
 * of them can exist before its person does. `email2author` is the invite and
 * the permission; `authors` is the profile, and has a record only once
 * somebody has actually signed in. An invited address with no author yet is
 * a real state worth showing — it is the difference between "not invited"
 * and "invited, hasn't turned up".
 *
 * The deactivated authors come back too: their invite is gone, so they are
 * not experts any more, but the record stays (an author is permanent) and
 * saying so is better than having somebody silently disappear from the list.
 */
export async function listExperts() {
    const { db, collection, getDocs } = await store();
    const [invites, authors] = await Promise.all([
        getDocs(collection(db, 'email2author')),
        getDocs(collection(db, 'authors')),
    ]);

    const byEmail = new Map();
    invites.forEach(d => {
        byEmail.set(d.id, {
            email: d.id,
            invitedBy: d.data()?.invitedBy ?? null,
            invitedAt: d.data()?.invitedAt ?? null,
            active: true,
            authorId: null,
            name: null,
            signedIn: false,
        });
    });

    authors.forEach(d => {
        const data = d.data() ?? {};
        const email = lower(data.e);
        if (!email) return;
        const existing = byEmail.get(email);
        if (existing) {
            existing.authorId = d.id;
            existing.name = data.n ?? null;
            existing.signedIn = true;
            return;
        }
        // An author with no invite: access was revoked. The record stays
        // because an author is permanent — his boards still name him and
        // his evaluations are still in his voice.
        byEmail.set(email, {
            email,
            invitedBy: null,
            invitedAt: null,
            active: false,
            authorId: d.id,
            name: data.n ?? null,
            signedIn: true,
        });
    });

    return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Invites somebody. The rules require the caller to already be an expert and
 * require `invitedBy` to be his own address — this checks neither, it just
 * fails a bit more helpfully than a permission error would.
 */
export async function inviteExpert(email) {
    if (!email || !email.includes('@')) {
        throw new Error('Please provide a valid email address.');
    }
    const normalized = lower(email);
    const { db, doc, setDoc } = await store();
    const record = {
        invitedBy: lower(current?.email) || 'an expert',
        invitedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'email2author', normalized), record);
    // The cache that decides which Claim buttons to draw does not hear about
    // a write made straight through the SDK. See boardRegistry.
    const { invalidateInvites } = await import('./boardRegistry');
    invalidateInvites();
    return { email: normalized, ...record };
}

/**
 * Revokes an expert: deletes his invite, marks his author record, and
 * releases the boards he was holding.
 *
 * **The delete comes first, and the order is the point.** It is the only
 * part that actually revokes anything — the moment it lands, every write he
 * attempts is refused, on the next request, everywhere. The other two are
 * bookkeeping: a flag so the interface can say he was revoked rather than
 * having him vanish, and orphaning so the boards he held go back to the team
 * instead of being frozen under a name that can no longer write them. If
 * either of those fails, he is still revoked and the tidy-up can be retried;
 * the reverse ordering would leave a window where his boards were already
 * gone and he could still write.
 */
export async function revokeExpert(email) {
    const normalized = lower(email);
    if (!normalized) throw new Error('Missing email.');
    if (current?.email && normalized === lower(current.email)) {
        throw new Error('You cannot revoke your own access.');
    }

    const { db, doc, deleteDoc, getDocs, collection } = await store();
    await deleteDoc(doc(db, 'email2author', normalized));
    const { invalidateInvites } = await import('./boardRegistry');
    invalidateInvites();

    // Find his author by the email stored on it. Nothing else links the two:
    // the invite is keyed by address and the author by uid, which is exactly
    // why the author carries a copy of the address.
    const authors = await getDocs(collection(db, 'authors'));
    let authorId = null;
    authors.forEach(d => { if (lower(d.data()?.e) === normalized) authorId = d.id; });
    if (!authorId) return { email: normalized, authorId: null };

    // His boards are deliberately NOT touched.
    //
    // Deleting the invite above already made them claimable: the rules ask
    // `ownerRevoked(board.o)` — is this owner still invited — against live
    // data, so a board whose owner has gone answers yes without anybody
    // having rewritten it. Stripping `o` as well would be maintained state
    // saying the same thing the derived check already says, and it would be
    // worse than redundant:
    //
    //   - It loses WHOSE board it was, so reinstating him needs a second
    //     pass to guess it back from authorship.
    //   - It can half-apply. The invite delete is one write and the board
    //     rewrite is another; a failure between them used to leave a man
    //     locked out with his boards still held, and nothing ever went back
    //     to finish it.
    //   - It discards a private board's own visibility argument: with `o`
    //     intact, reinstating him restores his privacy automatically,
    //     because it was never taken away.
    //
    // Only the flag is written, and only because the interface wants to say
    // "revoked" rather than infer it.
    const { markAuthorDeactivated } = await import('./boardRegistry');
    await markAuthorDeactivated(authorId, true);
    return { email: normalized, authorId };
}

/**
 * Puts a revoked expert back: restores the invite and clears the flag.
 *
 * His boards come back on their own. Revoking never took them — `o` still
 * holds his uid — so the moment the invite exists again `ownerRevoked()`
 * answers no and he owns exactly what he owned before, private settings and
 * all. Anything somebody else claimed while he was gone has their uid in
 * `o` now and stays theirs, which is the same answer the old reassignment
 * pass worked to reach, arrived at by not having done anything.
 */
export async function reinstateExpert(email, authorId = null) {
    const normalized = lower(email);
    if (!normalized) throw new Error('Missing email.');

    const { db, doc, setDoc, getDocs, collection } = await store();
    await setDoc(doc(db, 'email2author', normalized), {
        invitedBy: lower(current?.email) || 'an expert',
        invitedAt: new Date().toISOString(),
    });
    const { invalidateInvites } = await import('./boardRegistry');
    invalidateInvites();

    let id = authorId;
    if (!id) {
        const authors = await getDocs(collection(db, 'authors'));
        authors.forEach(d => { if (lower(d.data()?.e) === normalized) id = d.id; });
    }
    if (!id) return { email: normalized, authorId: null };

    const { markAuthorDeactivated } = await import('./boardRegistry');
    await markAuthorDeactivated(id, false);
    return { email: normalized, authorId: id };
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
            let invited;
            try {
                invited = await isEmailInvited(user.email);
            } catch (err) {
                // Could not confirm either way — offline, a blocked request,
                // or email2author unreachable. NOT the same as "confirmed
                // not allowed", and treating it as one is the bug this
                // project already shipped once (see the restore note below):
                // an expert would be signed out and silently demoted, and
                // because a local write wins on read (overlayAdapter.js),
                // every edit he makes afterward becomes a shadow copy that
                // never reaches the shared board. Keep the real session,
                // report him as not-yet-confirmed rather than not-allowed,
                // and let a later check — the next sign-in attempt, or this
                // listener firing again — resolve it for real.
                console.warn(`Could not confirm ${user.email} against email2author; keeping the session as not-yet-confirmed.`, err?.code ?? err);
                current = shape(user, current?.isAllowed ?? false, true);
                announce();
                return;
            }
            if (!invited) {
                console.warn(`${user.email} has no expert invite; continuing as a viewer.`);
                await demoteToViewer(fb);
                return;
            }
            // Confirmed before the record is written, so that isExpert() is
            // already true for the write itself — which is what the rules
            // require, and why the invite rather than the author is what
            // grants access.
            current = shape(user, true);
            try {
                await ensureAuthorRecord(user);
            } catch (err) {
                // He is still an expert — the invite said so. Only the
                // profile is missing, and the next sign-in will try again.
                console.warn('Could not create the author record.', err?.code ?? err);
            }
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
 * Checks the invite itself, on top of the auth-state listener
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

    let invited;
    try {
        invited = await isEmailInvited(email);
    } catch {
        // Leave the real Google session in place — the listener above will
        // retry the same check independently — rather than guessing either
        // way from a failed lookup.
        throw new Error('Could not verify your access right now. Try again in a moment.');
    }
    if (!invited) {
        await demoteToViewer(fb);
        throw new Error(`Access restricted: "${email}" has not been invited as an expert.`);
    }

    current = shape(user, true);
    try {
        await ensureAuthorRecord(user);
    } catch (err) {
        console.warn('Could not create the author record.', err?.code ?? err);
    }
    announce();
    return current;
}

/**
 * Re-runs the invite check for whoever Firebase already has signed
 * in, without a popup — the recovery action for `unconfirmed` (a real Google
 * session that couldn't be checked yet). No-op for a viewer or nobody.
 */
export async function recheckAccess() {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) return current;
    const user = auth.currentUser;

    let invited;
    try {
        invited = await isEmailInvited(user.email);
    } catch {
        throw new Error('Could not verify your access right now. Try again in a moment.');
    }
    const fb = await import('firebase/auth');
    if (!invited) {
        await demoteToViewer(fb);
        throw new Error(`Access restricted: "${user.email}" has not been invited as an expert.`);
    }

    current = shape(user, true);
    try {
        await ensureAuthorRecord(user);
    } catch (err) {
        console.warn('Could not create the author record.', err?.code ?? err);
    }
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
