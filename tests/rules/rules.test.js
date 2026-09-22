import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
    initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/**
 * What the rules actually permit, against a real Firestore.
 *
 * Everything else in this repo can only prove that a rule EXISTS for an
 * address — `rulesCoverage.test.js` parses the match statements and checks
 * every path the app writes is reachable. That is worth having, and it is not
 * the question that matters. The question that matters is whether an anonymous
 * viewer is refused, and whether Dan can write Ryan's board, and no amount of
 * reading the file can answer it: rules are evaluated by Firestore, and the
 * one time I reasoned about them by eye I got it wrong in a way that let every
 * expert overwrite every other expert's evaluations.
 *
 * So this runs against the emulator. It is NOT part of `npm test` — it needs a
 * JVM and a container, and a suite that cannot run everywhere is a suite that
 * stops being run. See tests/README.md.
 */
const PROJECT = 'demo-draftboard';

let env;

/**
 * An expert: signed in with Google, a verified email, defaulting to an
 * address the beforeEach below actually gives an email2author invite. Pass a
 * different email to build a Google account that has NOT been invited.
 *
 * The uid matters as much as the email now: an author IS the person, keyed
 * by uid, so `expert('dan-uid')` is simultaneously the signed-in session and
 * the author `dan-uid`.
 */
const expert = (uid, email = `${uid}@example.com`) =>
    env.authenticatedContext(uid, {
        firebase: { sign_in_provider: 'google.com' },
        email,
        email_verified: true,
    }).firestore();
/** A viewer: signed in anonymously, which is what every follower is. */
const viewer = () => env.authenticatedContext('anon', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
/** Nobody at all. */
const stranger = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: {
            host: '127.0.0.1',
            port: 8080,
            rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
        },
    });
});

afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    // The records ownership is decided from. Written with rules off, because
    // seeding is not what is under test.
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        // An author IS a person, keyed by his uid — so these are the same
        // strings the expert() contexts sign in as.
        await setDoc(doc(db, 'authors/dan-uid'), { n: 'Dan', e: 'dan-uid@example.com' });
        await setDoc(doc(db, 'authors/ryan-uid'), { n: 'Ryan', e: 'ryan-uid@example.com' });
        await setDoc(doc(db, 'boards/b_dan'), { l: 'Dan', a: 'dan-uid', o: 'dan-uid', s: 's_1' });
        await setDoc(doc(db, 'boards/b_consensus'), { l: 'Consensus', a: null, o: null, s: 's_1' });
        // A personal board nobody has claimed — the "orphaned" state the
        // claim/orphan tests exercise, distinct from consensus (which has no
        // author at all, not merely an unset owner). Its author is a
        // PLACEHOLDER with an opaque id, like the shipped Dan/Ryan seeds:
        // nobody signs in as him, so nobody can ever be him, and his board is
        // exactly the one a real expert is meant to be able to take over.
        await setDoc(doc(db, 'authors/a_orphan'), { n: 'Orphan', e: 'orphan@draftboard.local' });
        await setDoc(doc(db, 'boards/b_orphan'), { l: 'Orphan', a: 'a_orphan', o: null, s: 's_1' });
        await setDoc(doc(db, 'seasons/s_1'), { y: 2026, t: 'current' });
        // Both test experts need an invite for isExpert() to accept them —
        // matches the default email expert(uid) builds, `${uid}@example.com`.
        // Existence is the whole permission; there is nothing inside to read.
        await setDoc(doc(db, 'email2author/dan-uid@example.com'), { invitedBy: 'system', invitedAt: '2026-01-01' });
        await setDoc(doc(db, 'email2author/ryan-uid@example.com'), { invitedBy: 'system', invitedAt: '2026-01-01' });
    });
});

describe('a viewer', () => {
    it('reads the shared record — that is the whole point of following along', async () => {
        const db = viewer();
        await assertSucceeds(getDoc(doc(db, 'players/p_1')));
        await assertSucceeds(getDoc(doc(db, 'boards/b_dan')));
        await assertSucceeds(getDoc(doc(db, 'boards/b_dan/entries/p_1')));
        await assertSucceeds(getDoc(doc(db, 'evaluations/p_1/remarks/dan-uid')));
    });

    it('cannot write a player, a board, or anybody’s placements', async () => {
        const db = viewer();
        await assertFails(setDoc(doc(db, 'players/p_1'), { n: 'Somebody' }));
        await assertFails(setDoc(doc(db, 'boards/b_dan'), { l: 'Mine now' }));
        await assertFails(setDoc(doc(db, 'boards/b_dan/entries/p_1'), { r: 1 }));
        await assertFails(setDoc(doc(db, 'boards/b_consensus/entries/p_1'), { r: 1 }));
    });

    it('cannot write an evaluation, a season, or the draft', async () => {
        const db = viewer();
        await assertFails(setDoc(doc(db, 'evaluations/p_1/remarks/dan-uid'), { s: [] }));
        await assertFails(setDoc(doc(db, 'seasons/s_1'), { y: 2027 }));
        await assertFails(setDoc(doc(db, 'seasons/s_1/charts/rosterState/rows/qb'), { l: 'QB' }));
        await assertFails(setDoc(doc(db, 'draft_state/s_1'), { value: {} }));
    });

    it('cannot delete what an expert wrote', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_dan/entries/p_1'), { r: 1 });
        });
        await assertFails(deleteDoc(doc(viewer(), 'boards/b_dan/entries/p_1')));
    });
});

describe('somebody not signed in at all', () => {
    it('reads but does not write', async () => {
        await assertSucceeds(getDoc(doc(stranger(), 'boards/b_dan')));
        await assertFails(setDoc(doc(stranger(), 'players/p_1'), { n: 'X' }));
    });
});

describe('an expert', () => {
    it('writes his own board and its placements', async () => {
        const db = expert('dan-uid');
        await assertSucceeds(setDoc(doc(db, 'boards/b_dan'), { l: 'Dan', a: 'dan-uid', o: 'dan-uid', s: 's_1' }));
        await assertSucceeds(setDoc(doc(db, 'boards/b_dan/entries/p_1'), { r: 1, w: 1 }));
    });

    it('cannot write another expert’s board', async () => {
        // The asymmetry the whole design exists for.
        const db = expert('ryan-uid');
        await assertFails(setDoc(doc(db, 'boards/b_dan'), { l: 'Stolen' }));
        await assertFails(setDoc(doc(db, 'boards/b_dan/entries/p_1'), { r: 7 }));
    });

    it('may maintain the consensus board, which has no owner', async () => {
        // Consensus is derived rather than written by a person, so it is
        // unowned — and unowned means any expert, not nobody.
        const db = expert('ryan-uid');
        await assertSucceeds(setDoc(doc(db, 'boards/b_consensus/entries/p_1'), { r: 2 }));
    });

    it('writes the registry, seasons, charts and the draft, which are shared', async () => {
        const db = expert('dan-uid');
        await assertSucceeds(setDoc(doc(db, 'players/p_1'), { n: 'Fernando Mendoza' }));
        await assertSucceeds(setDoc(doc(db, 'seasons/s_1'), { y: 2026, t: 'current' }));
        await assertSucceeds(setDoc(doc(db, 'seasons/s_1/charts/rosterState/rows/qb'), { l: 'QB' }));
        await assertSucceeds(setDoc(doc(db, 'seasons/s_1/setup/season'), { at: 1 }));
        await assertSucceeds(setDoc(doc(db, 'draft_state/s_1'), { value: { currentPick: 1 } }));
    });

    it('cannot scatter entries under a board that does not exist', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'boards/b_invented/entries/p_1'), { r: 1 }));
    });
});

describe('evaluations, which are keyed by author', () => {
    it('let the author write his own', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'evaluations/p_1/remarks/dan-uid'), {
            s_1: { s: [{ t: 'Sticky in man coverage', a: 1 }] },
        }));
    });

    it('refuse another expert writing in his voice', async () => {
        // This is the bug the emulator exists to catch. The rule used to split
        // a composite key and look the left half up in /boards — for a personal
        // board that half is an AUTHOR id, the lookup found nothing, and every
        // expert could overwrite every other expert's evaluations.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'evaluations/p_1/remarks/dan-uid'), {
            s_1: { n: [{ t: 'Not mine to write', a: 1 }] },
        }));
    });

    it('let an expert write the consensus voice, which nobody owns', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'evaluations/p_1/remarks/b_consensus'), {
            s_1: { n: [{ t: 'Consensus has him CB1', a: 1 }] },
        }));
    });

    it('refuse a voice belonging to no author and no board', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'evaluations/p_1/remarks/a_invented'), {
            s_1: { n: [{ t: 'Nobody', a: 1 }] },
        }));
    });

    it('refuse a viewer entirely', async () => {
        await assertFails(setDoc(doc(viewer(), 'evaluations/p_1/remarks/dan-uid'), { s_1: { n: [{ t: 'x', a: 1 }] } }));
    });
});

describe('the floor', () => {
    it('denies a collection nobody has written a rule for', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'something_invented/x'), { a: 1 }));
        await assertFails(getDoc(doc(viewer(), 'something_invented/x')));
    });
});

describe('isExpert requires Google, a verified email, and the whitelist together', () => {
    // Each of these holds two of the three conditions and fails on the third
    // — the point is that no single condition is enough on its own.

    it('a listed email signed in through a different provider is refused', async () => {
        // The bypass this closed: the Firebase config is public, so with any
        // other sign-in method enabled, anybody could self-register a
        // password account claiming a listed expert's address.
        const db = env.authenticatedContext('dan-uid', {
            firebase: { sign_in_provider: 'password' },
            email: 'dan-uid@example.com',
            email_verified: true,
        }).firestore();
        await assertFails(setDoc(doc(db, 'boards/b_dan'), { l: 'Hijacked' }));
    });

    it('a listed Google account with an unverified email is refused', async () => {
        const db = env.authenticatedContext('dan-uid', {
            firebase: { sign_in_provider: 'google.com' },
            email: 'dan-uid@example.com',
            email_verified: false,
        }).firestore();
        await assertFails(setDoc(doc(db, 'boards/b_dan'), { l: 'Unverified' }));
    });

    it('a verified Google account not on the list is refused', async () => {
        await assertFails(setDoc(doc(expert('outsider-uid', 'outsider@example.com'), 'boards/b_dan'), { l: 'Stolen' }));
    });
});

describe('email2author — the invite, which IS the permission', () => {
    /** A Google-authenticated, verified user who has NOT been invited. */
    const outsider = () => expert('outsider-uid', 'outsider@example.com');

    it('an uninvited account cannot write boards, players, or the draft', async () => {
        const db = outsider();
        await assertFails(setDoc(doc(db, 'players/p_1'), { n: 'X' }));
        await assertFails(setDoc(doc(db, 'boards/b_dan'), { l: 'Stolen' }));
        await assertFails(setDoc(doc(db, 'draft_state/s_1'), { value: {} }));
    });

    it('an uninvited account cannot read someone else’s invite', async () => {
        await assertFails(getDoc(doc(outsider(), 'email2author/dan-uid@example.com')));
    });

    it('any signed-in Google user can read their OWN invite — this is what signInExpert() checks', async () => {
        await assertSucceeds(getDoc(doc(outsider(), 'email2author/outsider@example.com')));
    });

    it('an invited expert can read the whole list', async () => {
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
    });

    it('an expert can invite somebody, self-attributed', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'email2author/newperson@example.com'), {
            invitedBy: 'dan-uid@example.com',
            invitedAt: '2026-09-01',
        }));
    });

    it('cannot claim somebody else did the inviting', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'email2author/newperson@example.com'), {
            invitedBy: 'ryan-uid@example.com',
            invitedAt: '2026-09-01',
        }));
    });

    it('an existing invite cannot be rewritten — who invited whom is immutable', async () => {
        await assertFails(updateDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com'), {
            invitedBy: 'dan-uid@example.com',
        }));
    });

    it('an uninvited account cannot invite itself or anybody else', async () => {
        await assertFails(setDoc(doc(outsider(), 'email2author/newperson@example.com'), {
            invitedBy: 'outsider@example.com',
            invitedAt: '2026-09-01',
        }));
    });

    it('a viewer cannot touch email2author at all', async () => {
        const db = viewer();
        await assertFails(getDoc(doc(db, 'email2author/dan-uid@example.com')));
        await assertFails(setDoc(doc(db, 'email2author/viewer@example.com'), {
            invitedBy: 'x', invitedAt: 'x',
        }));
    });

    // --- revocation: deleting the invite, and nothing else ----------------

    it('an expert can revoke another by deleting his invite', async () => {
        await assertSucceeds(deleteDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
    });

    it('revocation takes effect immediately — no flag, no stale token', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'players/p_before'), { n: 'Still allowed' }));
        await assertSucceeds(deleteDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
        // players, not a board: b_dan is dan-uid's, so a board write would
        // fail on ownership alone and not isolate the mechanism under test.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'players/p_after'), { n: 'Refused now' }));
    });

    it('a revoked expert cannot write his own author record any more', async () => {
        await assertSucceeds(deleteDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/ryan-uid'), {
            n: 'Back In', e: 'ryan-uid@example.com',
        }));
    });

    it('a revoked expert cannot re-invite himself', async () => {
        await assertSucceeds(deleteDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
        await assertFails(setDoc(doc(expert('ryan-uid'), 'email2author/ryan-uid@example.com'), {
            invitedBy: 'ryan-uid@example.com', invitedAt: '2026-09-01',
        }));
    });

    it('deleting and recreating an author does not get access back', async () => {
        // The delete-and-recreate bypass, checked against the new shape:
        // authors cannot be deleted at all, and even if the record were gone
        // the invite is what grants access, not the record.
        await assertSucceeds(deleteDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
        await assertFails(deleteDoc(doc(expert('ryan-uid'), 'authors/ryan-uid')));
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/ryan-uid'), { n: 'Fresh' }));
    });

    it('reinstating restores write access', async () => {
        await assertSucceeds(deleteDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com')));
        await assertFails(setDoc(doc(expert('ryan-uid'), 'players/p_x'), { n: 'Refused' }));
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'email2author/ryan-uid@example.com'), {
            invitedBy: 'dan-uid@example.com', invitedAt: '2026-09-02',
        }));
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'players/p_y'), { n: 'Restored' }));
    });

    // --- first sign-in: the bootstrap the invite exists to break ----------

    it('an invited newcomer creates his OWN author record on first sign-in', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'email2author/new-uid@example.com'), {
            invitedBy: 'dan-uid@example.com', invitedAt: '2026-09-01',
        }));
        await assertSucceeds(setDoc(doc(expert('new-uid'), 'authors/new-uid'), {
            n: 'Newcomer', e: 'new-uid@example.com',
        }));
    });

    it('cannot create an author under a uid that is not his', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/dan-uid-2'), {
            n: 'Impersonation', e: 'ryan-uid@example.com',
        }));
    });

    it('an uninvited account cannot create an author at all', async () => {
        await assertFails(setDoc(doc(outsider(), 'authors/outsider-uid'), {
            n: 'Outsider', e: 'outsider@example.com',
        }));
    });
});

describe('board/author ownership: claim and orphan', () => {
    it('any expert can claim an orphaned board, for himself', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan', a: 'a_orphan', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('an author cannot be claimed at all — he is a person, not a seat', async () => {
        // The counterpart to claiming a board, and deliberately the opposite
        // answer. A board changes hands; an identity does not. There is no
        // ownership field left to claim WITH, so the nearest thing to taking
        // one over is rewriting who he is — which is what this attempts.
        //
        // The write has to CHANGE something to be a real attempt: the
        // not-me branch is a hasOnly(['x']) diff, and an empty diff (writing
        // a document's own current contents back) satisfies hasOnly
        // trivially. That no-op is harmless by construction — it cannot
        // alter anything — but it is not what this test is about.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/a_orphan'), {
            n: 'Ryan Now', e: 'ryan-uid@example.com',
        }));
    });

    it('claiming an orphaned board on somebody ELSE\'S behalf is refused', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan', a: 'a_orphan', o: 'some-other-uid', s: 's_1',
        }));
    });

    it('an expert writes his OWN author record, and only his own', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'authors/ryan-uid'), {
            n: 'Ryan Renamed', e: 'ryan-uid@example.com',
        }));
    });

    it('a non-owner cannot touch an owned board at all, claim included', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('an expert cannot rewrite somebody else\'s author record', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/dan-uid'), {
            n: 'Not Dan', e: 'ryan-uid@example.com',
        }));
    });

    it('an author can never be deleted, not even by himself', async () => {
        // Deleting one would strand every evaluation written in that voice
        // and every board that names him.
        await assertFails(deleteDoc(doc(expert('dan-uid'), 'authors/dan-uid')));
    });

    it('the owner can orphan his own board', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: null, s: 's_1',
        }));
    });

    it('another expert may set the deactivated flag, and ONLY that flag', async () => {
        // Informational, not a permission — deleting the invite is what
        // revokes. Revoking somebody must not also be a licence to rename
        // him, which is why the not-me branch is a one-key diff.
        await assertSucceeds(updateDoc(doc(expert('ryan-uid'), 'authors/dan-uid'), { x: true }));
        await assertFails(updateDoc(doc(expert('ryan-uid'), 'authors/dan-uid'), {
            x: true, n: 'Renamed While Revoking',
        }));
    });

    it('a non-owner cannot orphan somebody else\'s board', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: null, s: 's_1',
        }));
    });

    it('the owner cannot hand his board directly to somebody else — must orphan first', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('a viewer cannot create an author, even one keyed by his own uid', async () => {
        await assertFails(setDoc(doc(viewer(), 'authors/anon'), { n: 'Sneaky', e: 'x@y.z' }));
    });

    it('an expert may NOT edit an orphaned board\'s other fields without claiming it — orphaned is writable by nobody', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan (renamed)', a: 'a_orphan', o: null, s: 's_1',
        }));
    });

    it('an orphaned board\'s entries are readable by any expert, regardless of a private/expert v stored on it', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_orphan'), {
                l: 'Orphan', a: 'a_orphan', o: null, s: 's_1', v: 'private',
            });
            await setDoc(doc(ctx.firestore(), 'boards/b_orphan/entries/p_1'), { r: 1 });
        });
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_orphan/entries/p_1')));
    });

    it('a viewer still cannot read an orphaned board\'s entries, even one stored as v: expert — the orphaned floor is expert-only, not public', async () => {
        // b_orphan's default fixture has no v field, which already defaults
        // to public — a viewer reading THAT proves nothing about the
        // orphaned clause specifically, since it would pass on v alone. Set
        // v explicitly so only the orphaned-clause could be granting access.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_orphan'), {
                l: 'Orphan', a: 'a_orphan', o: null, s: 's_1', v: 'expert',
            });
            await setDoc(doc(ctx.firestore(), 'boards/b_orphan/entries/p_1'), { r: 1 });
        });
        await assertFails(getDoc(doc(viewer(), 'boards/b_orphan/entries/p_1')));
    });

    it('orphaning a private board no longer locks out reads — any expert can see it, but nobody (including the former owner) can write it', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'authors/a_private'), { n: 'Private', e: 'private@draftboard.local' });
            await setDoc(doc(ctx.firestore(), 'boards/b_private'), {
                l: 'Private', a: 'a_private', o: null, s: 's_1', v: 'private',
            });
            await setDoc(doc(ctx.firestore(), 'boards/b_private/entries/p_1'), { r: 1 });
        });
        // The former owner reads fine now (any expert can, while orphaned) —
        // but cannot write: ownsBoard no longer covers an orphaned board, and
        // this isn't a claim (o stays null).
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'boards/b_private/entries/p_1')));
        await assertFails(setDoc(doc(expert('dan-uid'), 'boards/b_private/entries/p_1'), { r: 2 }));
        // A different expert reads fine too, and CAN claim it (the one write
        // orphaned allows) — after which the ex-owner has no special status.
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_private/entries/p_1')));
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_private'), {
            l: 'Private', a: 'a_private', o: 'ryan-uid', s: 's_1', v: 'private',
        }));
    });

    it('the consensus board (no author at all) is still writable by any expert, unaffected', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_consensus'), {
            l: 'Consensus', a: null, o: null, s: 's_1',
        }));
    });

    it('the consensus board can never be claimed - no authorId means no owner, ever', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_consensus'), {
            l: 'Consensus', a: null, o: 'ryan-uid', s: 's_1',
        }));
    });

    it('a viewer cannot claim an orphaned board', async () => {
        await assertFails(setDoc(doc(viewer(), 'boards/b_orphan'), {
            l: 'Orphan', a: 'a_orphan', o: 'anon', s: 's_1',
        }));
    });

    it('deleting the consensus board and recreating it solely owned is refused too - not just editing it in place', async () => {
        const db = expert('ryan-uid');
        await assertSucceeds(deleteDoc(doc(db, 'boards/b_consensus')));
        await assertFails(setDoc(doc(db, 'boards/b_consensus'), {
            l: 'Consensus', a: null, o: 'ryan-uid', s: 's_1',
        }));
    });
});

describe('board visibility: private/expert/public entries', () => {
    // The board DOCUMENT is never gated by visibility — only its entries
    // subcollection is (see boardVisible() in firestore.rules for why: a
    // rule on a listed collection reading its own resource.data either
    // leaks or breaks the whole list, measured, not theoretical). So every
    // one of these seeds a board whose own read stays open and checks the
    // entries collection specifically.
    const seedBoard = (id, authorId, ownerId, visibility) => env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `boards/${id}`), { l: id, a: authorId, o: ownerId, s: 's_1', v: visibility });
        await setDoc(doc(ctx.firestore(), `boards/${id}/entries/p_1`), { r: 1 });
    });

    it('a public board (no v, or v: public) is readable by anyone, including a viewer', async () => {
        // No `v` at all - existing/legacy boards, must default to public.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_dan/entries/p_nov'), { r: 1 });
        });
        await assertSucceeds(getDoc(doc(viewer(), 'boards/b_dan/entries/p_nov')));

        await seedBoard('b_pub', 'dan-uid', 'dan-uid', 'public');
        await assertSucceeds(getDoc(doc(viewer(), 'boards/b_pub/entries/p_1')));
        await assertSucceeds(getDoc(doc(stranger(), 'boards/b_pub/entries/p_1')));
    });

    it('an expert-tier board is readable by any signed-in expert, refused for a viewer', async () => {
        await seedBoard('b_exp', 'dan-uid', 'dan-uid', 'expert');
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'boards/b_exp/entries/p_1')));
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_exp/entries/p_1')));
        await assertFails(getDoc(doc(viewer(), 'boards/b_exp/entries/p_1')));
        await assertFails(getDoc(doc(stranger(), 'boards/b_exp/entries/p_1')));
    });

    it('a private board is readable only by its owner - not another expert, not a viewer', async () => {
        await seedBoard('b_priv', 'dan-uid', 'dan-uid', 'private');
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'boards/b_priv/entries/p_1')));
        await assertFails(getDoc(doc(expert('ryan-uid'), 'boards/b_priv/entries/p_1')));
        await assertFails(getDoc(doc(viewer(), 'boards/b_priv/entries/p_1')));
    });

    it('the shared/consensus board stays public regardless of any v value stored on it', async () => {
        // Nothing in the app can set v on a no-author board to anything that
        // would matter, but confirm the RULE itself doesn't trust the stored
        // value for a shared board - authorId null is what settles it.
        await seedBoard('b_shared_priv', null, null, 'private');
        await assertSucceeds(getDoc(doc(viewer(), 'boards/b_shared_priv/entries/p_1')));
    });

    it('entries under a board that does not exist read as public rather than erroring', async () => {
        await assertSucceeds(getDoc(doc(viewer(), 'boards/b_invented/entries/p_1')));
    });

    it('an owner can change visibility, and the new value takes effect immediately', async () => {
        await seedBoard('b_change', 'dan-uid', 'dan-uid', 'private');
        await assertFails(getDoc(doc(expert('ryan-uid'), 'boards/b_change/entries/p_1')));
        await assertSucceeds(updateDoc(doc(expert('dan-uid'), 'boards/b_change'), { v: 'public' }));
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_change/entries/p_1')));
    });
});

/**
 * A revoked expert's boards, and why nothing rewrites them.
 *
 * Revoking deletes the invite and nothing else. The board keeps his uid in
 * `o`, and becomes claimable because the rules ASK whether that owner is
 * still invited — `ownerRevoked()` — rather than because some earlier write
 * remembered to release it. Two things fall out of that, and both are tested
 * here: a board can never be left frozen by a half-finished revocation, and
 * reinstating him gives everything back, private settings included, because
 * nothing was ever taken away.
 */
describe('a revoked expert’s boards', () => {
    // dan-uid holds b_dan and has an author carrying his address; deleting
    // the invite is the whole of a revocation.
    const revokeDan = () => env.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), 'email2author/dan-uid@example.com'));
    });
    const reinstateDan = () => env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'email2author/dan-uid@example.com'), {
            invitedBy: 'system', invitedAt: '2026-01-02',
        });
    });

    it('are claimable by another expert once the invite is gone', async () => {
        await revokeDan();
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('are NOT claimable while he still holds an invite', async () => {
        // The same write, refused purely because he has not been revoked —
        // this is what proves the test above is testing revocation and not
        // some general permissiveness.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('still cannot be claimed on a third party’s behalf', async () => {
        await revokeDan();
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'someone-else-uid', s: 's_1',
        }));
    });

    it('still cannot be claimed by a viewer', async () => {
        await revokeDan();
        await assertFails(setDoc(doc(viewer(), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'anon', s: 's_1',
        }));
    });

    it('does not make the SHARED board claimable — it has no owner to revoke', async () => {
        await revokeDan();
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_consensus'), {
            l: 'Consensus', a: null, o: 'ryan-uid', s: 's_1',
        }));
    });

    it('leaves a private board readable by any expert, rather than by nobody', async () => {
        // The lockout this branch exists to prevent: the owner-match branch
        // needs o == my uid, and a revoked man's uid is nobody else's, so
        // without ownerRevoked() his private board would be unreadable by
        // everyone — including him.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_dan'), {
                l: 'Dan', a: 'dan-uid', o: 'dan-uid', s: 's_1', v: 'private',
            });
            await setDoc(doc(ctx.firestore(), 'boards/b_dan/entries/p_1'), { r: 1 });
        });
        await assertFails(getDoc(doc(expert('ryan-uid'), 'boards/b_dan/entries/p_1')));
        await revokeDan();
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_dan/entries/p_1')));
    });

    it('keeps a private board hidden from a VIEWER even after revocation', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_dan'), {
                l: 'Dan', a: 'dan-uid', o: 'dan-uid', s: 's_1', v: 'private',
            });
            await setDoc(doc(ctx.firestore(), 'boards/b_dan/entries/p_1'), { r: 1 });
        });
        await revokeDan();
        await assertFails(getDoc(doc(viewer(), 'boards/b_dan/entries/p_1')));
    });

    it('come back to him on reinstatement, with no reassignment step', async () => {
        await revokeDan();
        await reinstateDan();
        // He owns it again because `o` never stopped saying so.
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'dan-uid', s: 's_1',
        }));
        // And it is nobody else's to take again.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('stay with whoever claimed them while he was gone', async () => {
        await revokeDan();
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
        await reinstateDan();
        // Reinstating him does not take it back off Ryan.
        await assertFails(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'dan-uid', s: 's_1',
        }));
    });

    it('an owner with no author record at all is not treated as revoked', async () => {
        // ensureAuthorRecord's failure path is deliberately non-fatal, so an
        // active expert can hold a board while having no author document.
        // ownerRevoked() guards on exists() precisely so that reads as "not
        // revoked" rather than throwing — a thrown rule denies everything.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'boards/b_noauthor'), {
                l: 'No author', a: 'ghost-uid', o: 'ghost-uid', s: 's_1',
            });
        });
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_noauthor'), {
            l: 'No author', a: 'ghost-uid', o: 'ryan-uid', s: 's_1',
        }));
    });
});

/**
 * The two holes an independent review reproduced after the identity rebuild
 * shipped, both of which this file's comments had asserted were impossible.
 *
 * Both were invisible to the tests above for the same structural reason:
 * every board test here writes the whole document in ONE setDoc, and both
 * attacks need two writes. A rule that branches on a field's previous value
 * is only an invariant if the same write cannot change that field, and
 * nothing was stopping either one.
 */
describe('multi-write attacks the single-write tests could not see', () => {
    it('cannot capture the shared board by setting an author first, then claiming', async () => {
        const db = expert('ryan-uid');
        // Step one used to be ALLOWED: with `a` still null beforehand this is
        // the shared board, which any expert may maintain.
        await assertFails(setDoc(doc(db, 'boards/b_consensus'), {
            l: 'Consensus', a: 'ryan-uid', o: null, s: 's_1',
        }));
        // And with step one refused, step two has nothing to stand on — but
        // assert it directly too, so the test still means something if the
        // first line's reason ever changes.
        await assertFails(setDoc(doc(db, 'boards/b_consensus'), {
            l: 'Consensus', a: 'ryan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('cannot rewrite authorship while claiming an orphaned board', async () => {
        // Claiming b_orphan is legitimate; erasing whose work it was in the
        // same write is not.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan', a: 'ryan-uid', o: 'ryan-uid', s: 's_1',
        }));
        // The honest claim, leaving authorship alone, still works.
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan', a: 'a_orphan', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('cannot reattribute a board he already owns', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'ryan-uid', o: 'dan-uid', s: 's_1',
        }));
    });

    it('cannot point his own author record at somebody else’s invite', async () => {
        // The capture that made revocation unenforceable: rewrite `e` to a
        // colleague's address, and ownerRevoked() afterwards follows it to
        // that colleague's live invite and reports you still invited — for
        // good, with your boards unclaimable and your private boards
        // unreadable by anyone.
        await assertFails(setDoc(doc(expert('dan-uid'), 'authors/dan-uid'), {
            n: 'Dan', e: 'ryan-uid@example.com',
        }));
    });

    it('can still write his own author record, leaving the address alone', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'authors/dan-uid'), {
            n: 'Dan The Man', e: 'dan-uid@example.com',
        }));
    });

    it('cannot create an author record carrying an address that is not his', async () => {
        // Same capture, taken at creation instead of by amendment. Seeded
        // with rules off rather than via the fixtures, so the invite exists
        // only for this test — the suite has another that asserts an expert
        // can CREATE this very invite, and a pre-existing one would turn that
        // create into an update, which email2author refuses by design.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'email2author/new-uid@example.com'), {
                invitedBy: 'system', invitedAt: '2026-01-01',
            });
        });
        await assertFails(setDoc(doc(expert('new-uid', 'new-uid@example.com'), 'authors/new-uid'), {
            n: 'New', e: 'dan-uid@example.com',
        }));
    });

    it('revocation still bites after an attempted address rewrite', async () => {
        // End to end: the rewrite is refused, so revoking works normally and
        // the board becomes claimable the way it should.
        await assertFails(setDoc(doc(expert('dan-uid'), 'authors/dan-uid'), {
            n: 'Dan', e: 'ryan-uid@example.com',
        }));
        await env.withSecurityRulesDisabled(async (ctx) => {
            await deleteDoc(doc(ctx.firestore(), 'email2author/dan-uid@example.com'));
        });
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });
});

/**
 * An author record carries a real person's email address, so it is the one
 * shared record here that is NOT world-readable.
 */
describe('author records are not public', () => {
    it('a viewer cannot read an author, and neither can a stranger', async () => {
        await assertFails(getDoc(doc(viewer(), 'authors/dan-uid')));
        await assertFails(getDoc(doc(stranger(), 'authors/dan-uid')));
    });

    it('an expert can read them — the experts list and revoke both need it', async () => {
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'authors/dan-uid')));
    });

    it('a revoked person can still read his OWN record, to be told he was revoked', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await deleteDoc(doc(ctx.firestore(), 'email2author/dan-uid@example.com'));
        });
        // No longer an expert, so somebody else's record is refused...
        await assertFails(getDoc(doc(expert('dan-uid'), 'authors/ryan-uid')));
        // ...but his own still answers, which is what lets the app say
        // "revoked" rather than "never invited".
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'authors/dan-uid')));
    });

    it('revocation still derives correctly even though the author is now private', async () => {
        // ownerRevoked() reads the author with a rule-internal get(), which
        // is not subject to the read rule above — so making authors private
        // must not change any ownership answer.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await deleteDoc(doc(ctx.firestore(), 'email2author/dan-uid@example.com'));
        });
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'dan-uid', o: 'ryan-uid', s: 's_1',
        }));
    });
});
