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
 * address the beforeEach below actually puts on allowed_users. Pass a
 * different email to build a Google account that ISN'T listed.
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
        await setDoc(doc(db, 'authors/a_dan'), { n: 'Dan', o: 'dan-uid' });
        await setDoc(doc(db, 'authors/a_ryan'), { n: 'Ryan', o: 'ryan-uid' });
        await setDoc(doc(db, 'boards/b_dan'), { l: 'Dan', a: 'a_dan', o: 'dan-uid', s: 's_1' });
        await setDoc(doc(db, 'boards/b_consensus'), { l: 'Consensus', a: null, o: null, s: 's_1' });
        // A personal board/author nobody has claimed — the "orphaned" state
        // the claim/orphan tests below exercise, distinct from consensus
        // (which has no author at all, not merely an unset owner).
        await setDoc(doc(db, 'authors/a_orphan'), { n: 'Orphan', o: null });
        await setDoc(doc(db, 'boards/b_orphan'), { l: 'Orphan', a: 'a_orphan', o: null, s: 's_1' });
        await setDoc(doc(db, 'seasons/s_1'), { y: 2026, t: 'current' });
        // Both test experts must be listed for isExpert() to accept them —
        // matches the default email expert(uid) builds, `${uid}@example.com`.
        await setDoc(doc(db, 'allowed_users/dan-uid@example.com'), { email: 'dan-uid@example.com', addedBy: 'system', addedAt: '2026-01-01' });
        await setDoc(doc(db, 'allowed_users/ryan-uid@example.com'), { email: 'ryan-uid@example.com', addedBy: 'system', addedAt: '2026-01-01' });
    });
});

describe('a viewer', () => {
    it('reads the shared record — that is the whole point of following along', async () => {
        const db = viewer();
        await assertSucceeds(getDoc(doc(db, 'players/p_1')));
        await assertSucceeds(getDoc(doc(db, 'boards/b_dan')));
        await assertSucceeds(getDoc(doc(db, 'boards/b_dan/entries/p_1')));
        await assertSucceeds(getDoc(doc(db, 'evaluations/p_1/remarks/a_dan')));
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
        await assertFails(setDoc(doc(db, 'evaluations/p_1/remarks/a_dan'), { s: [] }));
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
        await assertSucceeds(setDoc(doc(db, 'boards/b_dan'), { l: 'Dan', a: 'a_dan', o: 'dan-uid', s: 's_1' }));
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
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'evaluations/p_1/remarks/a_dan'), {
            s_1: { s: [{ t: 'Sticky in man coverage', a: 1 }] },
        }));
    });

    it('refuse another expert writing in his voice', async () => {
        // This is the bug the emulator exists to catch. The rule used to split
        // a composite key and look the left half up in /boards — for a personal
        // board that half is an AUTHOR id, the lookup found nothing, and every
        // expert could overwrite every other expert's evaluations.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'evaluations/p_1/remarks/a_dan'), {
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
        await assertFails(setDoc(doc(viewer(), 'evaluations/p_1/remarks/a_dan'), { s_1: { n: [{ t: 'x', a: 1 }] } }));
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

describe('allowed_users', () => {
    /** A Google-authenticated, verified user whose email is NOT listed. */
    const outsider = () => expert('outsider-uid', 'outsider@example.com');

    it('an unlisted account cannot write boards, players, or the draft', async () => {
        const db = outsider();
        await assertFails(setDoc(doc(db, 'players/p_1'), { n: 'X' }));
        await assertFails(setDoc(doc(db, 'boards/b_dan'), { l: 'Stolen' }));
        await assertFails(setDoc(doc(db, 'draft_state/s_1'), { value: {} }));
    });

    it('an unlisted account cannot read someone else’s entry', async () => {
        await assertFails(getDoc(doc(outsider(), 'allowed_users/dan-uid@example.com')));
    });

    it('any signed-in Google user can read their OWN entry, listed or not — this is what signInExpert() checks', async () => {
        await assertSucceeds(getDoc(doc(outsider(), 'allowed_users/outsider@example.com')));
    });

    it('a listed expert can read the whole list', async () => {
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com')));
    });

    it('a listed expert can add a new expert, self-attributed', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'allowed_users/newperson@example.com'), {
            email: 'newperson@example.com',
            addedBy: 'dan-uid@example.com',
            addedAt: '2026-09-01',
        }));
    });

    it('cannot claim someone else added the entry', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'allowed_users/newperson@example.com'), {
            email: 'newperson@example.com',
            addedBy: 'ryan-uid@example.com',
            addedAt: '2026-09-01',
        }));
    });

    it('the email field must match the document id', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'allowed_users/newperson@example.com'), {
            email: 'somebody-else@example.com',
            addedBy: 'dan-uid@example.com',
            addedAt: '2026-09-01',
        }));
    });

    it('an existing entry cannot be rewritten — immutable once written', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com'), {
            email: 'ryan-uid@example.com',
            addedBy: 'dan-uid@example.com',
            addedAt: 'rewritten',
        }));
    });

    it('nobody can delete an entry — that is a console operation', async () => {
        await assertFails(deleteDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com')));
    });

    it('an unlisted account cannot add itself or anybody else', async () => {
        await assertFails(setDoc(doc(outsider(), 'allowed_users/newperson@example.com'), {
            email: 'newperson@example.com',
            addedBy: 'outsider@example.com',
            addedAt: '2026-09-01',
        }));
    });

    it('a viewer cannot touch allowed_users at all', async () => {
        const db = viewer();
        await assertFails(getDoc(doc(db, 'allowed_users/dan-uid@example.com')));
        await assertFails(setDoc(doc(db, 'allowed_users/viewer@example.com'), {
            email: 'viewer@example.com', addedBy: 'x', addedAt: 'x',
        }));
    });

    it('an expert can deactivate another expert by updating ONLY active', async () => {
        await assertSucceeds(updateDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com'), {
            active: false,
        }));
    });

    it('an update touching any other field alongside active is refused', async () => {
        await assertFails(updateDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com'), {
            active: false, addedBy: 'dan-uid@example.com',
        }));
    });

    it('a deactivated expert (active: false) is refused a board write', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'allowed_users/ryan-uid@example.com'), {
                email: 'ryan-uid@example.com', addedBy: 'dan-uid@example.com', addedAt: '2026-01-01', active: false,
            });
        });
        // players, not a board — b_dan is dan-uid's board, so writing it as
        // ryan would fail on ownership alone and not actually isolate the
        // active-flag mechanism this test is about.
        await assertFails(setDoc(doc(expert('ryan-uid'), 'players/p_active_test'), { n: 'Should be refused' }));
    });

    it('active as a string ("false") is also refused — not just the boolean', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'allowed_users/ryan-uid@example.com'), {
                email: 'ryan-uid@example.com', addedBy: 'dan-uid@example.com', addedAt: '2026-01-01', active: 'false',
            });
        });
        await assertFails(setDoc(doc(expert('ryan-uid'), 'players/p_active_test'), { n: 'Should be refused' }));
    });

    it('a type-mismatched active value is refused on the write that sets it, too', async () => {
        await assertFails(updateDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com'), {
            active: 'false',
        }));
    });

    it('reactivating restores write access', async () => {
        await env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), 'allowed_users/ryan-uid@example.com'), {
                email: 'ryan-uid@example.com', addedBy: 'dan-uid@example.com', addedAt: '2026-01-01', active: false,
            });
        });
        await assertSucceeds(updateDoc(doc(expert('dan-uid'), 'allowed_users/ryan-uid@example.com'), {
            active: true,
        }));
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'players/p_active_test'), { n: 'Restored' }));
    });
});

describe('board/author ownership: claim and orphan', () => {
    it('any expert can claim an orphaned board, for himself', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan', a: 'a_orphan', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('any expert can claim an orphaned author, for himself', async () => {
        await assertSucceeds(setDoc(doc(expert('ryan-uid'), 'authors/a_orphan'), {
            n: 'Orphan', o: 'ryan-uid',
        }));
    });

    it('claiming an orphaned board on somebody ELSE\'S behalf is refused', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_orphan'), {
            l: 'Orphan', a: 'a_orphan', o: 'some-other-uid', s: 's_1',
        }));
    });

    it('claiming an orphaned author on somebody ELSE\'S behalf is refused', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/a_orphan'), {
            n: 'Orphan', o: 'some-other-uid',
        }));
    });

    it('a non-owner cannot touch an owned board at all, claim included', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'a_dan', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('a non-owner cannot touch an owned author at all, claim included', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'authors/a_dan'), {
            n: 'Dan', o: 'ryan-uid',
        }));
    });

    it('the owner can orphan his own board', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'a_dan', o: null, s: 's_1',
        }));
    });

    it('the owner can orphan his own author', async () => {
        await assertSucceeds(setDoc(doc(expert('dan-uid'), 'authors/a_dan'), {
            n: 'Dan', o: null,
        }));
    });

    it('a non-owner cannot orphan somebody else\'s board', async () => {
        await assertFails(setDoc(doc(expert('ryan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'a_dan', o: null, s: 's_1',
        }));
    });

    it('the owner cannot hand his board directly to somebody else — must orphan first', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'boards/b_dan'), {
            l: 'Dan', a: 'a_dan', o: 'ryan-uid', s: 's_1',
        }));
    });

    it('the owner cannot hand his author directly to somebody else — must orphan first', async () => {
        await assertFails(setDoc(doc(expert('dan-uid'), 'authors/a_dan'), {
            n: 'Dan', o: 'ryan-uid',
        }));
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
            await setDoc(doc(ctx.firestore(), 'authors/a_private'), { n: 'Private', o: 'dan-uid' });
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

        await seedBoard('b_pub', 'a_dan', 'dan-uid', 'public');
        await assertSucceeds(getDoc(doc(viewer(), 'boards/b_pub/entries/p_1')));
        await assertSucceeds(getDoc(doc(stranger(), 'boards/b_pub/entries/p_1')));
    });

    it('an expert-tier board is readable by any signed-in expert, refused for a viewer', async () => {
        await seedBoard('b_exp', 'a_dan', 'dan-uid', 'expert');
        await assertSucceeds(getDoc(doc(expert('dan-uid'), 'boards/b_exp/entries/p_1')));
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_exp/entries/p_1')));
        await assertFails(getDoc(doc(viewer(), 'boards/b_exp/entries/p_1')));
        await assertFails(getDoc(doc(stranger(), 'boards/b_exp/entries/p_1')));
    });

    it('a private board is readable only by its owner - not another expert, not a viewer', async () => {
        await seedBoard('b_priv', 'a_dan', 'dan-uid', 'private');
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
        await seedBoard('b_change', 'a_dan', 'dan-uid', 'private');
        await assertFails(getDoc(doc(expert('ryan-uid'), 'boards/b_change/entries/p_1')));
        await assertSucceeds(updateDoc(doc(expert('dan-uid'), 'boards/b_change'), { v: 'public' }));
        await assertSucceeds(getDoc(doc(expert('ryan-uid'), 'boards/b_change/entries/p_1')));
    });
});
