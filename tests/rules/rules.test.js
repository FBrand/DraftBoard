import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
    initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
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

/** An expert: signed in with a real provider. */
const expert = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).firestore();
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
        await setDoc(doc(db, 'seasons/s_1'), { y: 2026, t: 'current' });
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
