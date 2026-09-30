import { describe, it, expect, beforeEach } from 'vitest';
import {
    myVoice, voicesFor, openEvaluations, remarksFor, addRemark,
    updateRemarkText, removeRemark, REMARK_KINDS,
} from '../../src/utils/evaluations';
import { openBoards, allBoards, renameBoard, renameAuthor, authorOf, currentSeason } from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';
// Evaluations moved to the layered store; this is where they live now.
import { store } from '../../src/data/appStore';

/**
 * Who wrote a remark, about whom, and in which season.
 *
 * Replaces `evaluations.spec.js` ("a remark is stored against the author,
 * stamped with the season", "remarks do not live on the board entry any
 * more", "survives a reload") and the evaluation half of `identity.spec.js`
 * ("evaluations are stored against the id, not the name", "a rename keeps the
 * id, and the evaluation follows the player").
 *
 * A remark is an author's opinion of a player. Both ends are ids, which is
 * what lets a board be renamed, a player be corrected, and a season roll over
 * without the writing going missing.
 */
beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    store.forget();
    await openBoards();
    // Remarks are filed under the season in their path, and a read visits the
    // seasons that exist — so 's1' has to be one. See remarkStorage.test.js,
    // which has this as its own case.
    await repository.ready('seasons');
    repository.set('seasons', 's1', { id: 's1', year: 2026, status: 'current' });
    await openEvaluations();
});

const personal = () => allBoards().find(b => b.authorId);
const consensus = () => allBoards().find(b => !b.authorId);

describe('whose opinion it is', () => {
    // There is no longer a function that answers "whose opinion does this
    // BOARD hold", because a board does not hold one. voiceOf used to, and
    // every caller of it was a place asking a board a question about a person:
    // the card's stack, the delete-safety check, the CSV export. The whole
    // key space it produced was a union of author ids and board ids with
    // nothing to tell them apart.
    it('is not something a board can be asked', async () => {
        const evaluations = await import('../../src/utils/evaluations');
        expect(evaluations.voiceOf).toBeUndefined();
    });

    it('is nobody for consensus, because a board does not have opinions', () => {
        // Consensus is derived and has no person behind it. What anybody
        // writes while looking at it is written in their own name.
        expect(consensus().authorId).toBeNull();
    });

    it('is me when I am the one writing', () => {
        // The rules derive the same answer from the token, which is what makes
        // ownsVoice a comparison rather than a lookup — and what the old
        // board-derived answer could never agree with.
        expect(myVoice()).toEqual(expect.any(String));
    });
});

describe('writing a remark', () => {
    it('stores it against the owner and the player id, stamped with the season', () => {
        const owner = myVoice();
        const season = currentSeason().id;

        const remark = addRemark(owner, 'p_mendoza', 'strength', 'Reads coverage early', season);

        expect(remark.kind).toBe('strength');
        expect(remark.seasonId).toBe(season);
        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('does not leak between analysts', () => {
        addRemark('author_a', 'p_mendoza', 'note', 'Mine', currentSeason().id);

        expect(remarksFor('author_a', 'p_mendoza')).toHaveLength(1);
        expect(remarksFor('author_b', 'p_mendoza')).toHaveLength(0);
    });

    it('does not leak between players', () => {
        const owner = myVoice();
        addRemark(owner, 'p_mendoza', 'note', 'Mine', currentSeason().id);
        expect(remarksFor(owner, 'p_reese')).toHaveLength(0);
    });

    it('refuses a blank body, a bad kind, or a missing end', () => {
        const owner = myVoice();
        expect(addRemark(owner, 'p1', 'strength', '   ', 's1')).toBeNull();
        expect(addRemark(owner, 'p1', 'vibes', 'text', 's1')).toBeNull();
        expect(addRemark(null, 'p1', 'note', 'text', 's1')).toBeNull();
        expect(addRemark(owner, null, 'note', 'text', 's1')).toBeNull();
        expect(remarksFor(owner, 'p1')).toHaveLength(0);
    });

    it('takes all three kinds and keeps them apart', () => {
        const owner = myVoice();
        REMARK_KINDS.forEach(kind => addRemark(owner, 'p1', kind, `a ${kind}`, 's1'));
        expect(remarksFor(owner, 'p1').map(r => r.kind)).toEqual(REMARK_KINDS);
    });
});

describe('everybody who has written about a player', () => {
    it('is found without naming a single board', () => {
        const a = personal().authorId;
        addRemark(a, 'p_mendoza', 'note', 'His', currentSeason().id);
        // Somebody with no board at all. Under the board-walked version he
        // could not appear on the card however much he wrote.
        addRemark('a_nobodys_board', 'p_mendoza', 'note', 'Also his', currentSeason().id);

        const voices = voicesFor('p_mendoza').map(v => v.voiceId);
        expect(voices).toContain(a);
        expect(voices).toContain('a_nobodys_board');
    });

    it('leaves out a voice that has written nothing', () => {
        addRemark(personal().authorId, 'p_mendoza', 'note', 'His', currentSeason().id);
        expect(voicesFor('p_mendoza').map(v => v.voiceId)).not.toContain(consensus().id);
    });

    it('is nothing for a player nobody has written about', () => {
        expect(voicesFor('p_untouched')).toEqual([]);
        expect(voicesFor(null)).toEqual([]);
    });
});

describe('a remark is not on the board entry', () => {
    it('survives renaming the board it was written from', () => {
        const board = personal();
        const owner = board.authorId;
        addRemark(owner, 'p_mendoza', 'note', 'Still here', currentSeason().id);

        renameBoard(board.id, 'A Totally New Name');

        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('survives renaming the analyst, because it is keyed by his id', () => {
        const board = personal();
        const owner = board.authorId;
        addRemark(owner, 'p_mendoza', 'note', 'Still here', currentSeason().id);

        renameAuthor(board.authorId, 'A Different Person Entirely');

        expect(authorOf(board).name).toBe('A Different Person Entirely');
        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('is keyed by player id, so correcting a player’s name does not lose it', () => {
        // The id is what is stored. A name is a fact about the player and can
        // be wrong; nothing addresses a remark by it.
        const owner = myVoice();
        addRemark(owner, 'p_mendoza', 'note', 'Spelled his name wrong at first', 's1');
        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });
});

describe('editing and deleting', () => {
    it('rewords without moving the season stamp — that records when it was written', () => {
        const owner = myVoice();
        const remark = addRemark(owner, 'p1', 'note', 'Teh quick brown fox', 's1');

        expect(updateRemarkText(owner, 'p1', remark.id, 'The quick brown fox')).toBe(true);
        const [after] = remarksFor(owner, 'p1');
        expect(after.text).toBe('The quick brown fox');
        expect(after.seasonId).toBe('s1');
    });

    it('treats emptying the text as deleting it', () => {
        const owner = myVoice();
        const remark = addRemark(owner, 'p1', 'note', 'Never mind', 's1');
        updateRemarkText(owner, 'p1', remark.id, '   ');
        expect(remarksFor(owner, 'p1')).toHaveLength(0);
    });

    it('removes one and leaves the rest', () => {
        const owner = myVoice();
        const first = addRemark(owner, 'p1', 'note', 'One', 's1');
        addRemark(owner, 'p1', 'note', 'Two', 's1');

        expect(removeRemark(owner, 'p1', first.id)).toBe(true);
        expect(remarksFor(owner, 'p1').map(r => r.text)).toEqual(['Two']);
    });

    it('reports rather than pretends when the remark is not there', () => {
        const owner = myVoice();
        expect(removeRemark(owner, 'p1', 'r_nope')).toBe(false);
        expect(updateRemarkText(owner, 'p1', 'r_nope', 'x')).toBe(false);
    });
});

/**
 * A remark's id is its own, not where it sits.
 *
 * The handle used to be `season:kind:index` — a position in an array. So every
 * remark's id changed the moment anything before it was removed: delete the
 * first strength and the second one's handle points at what used to be the
 * third. A card holding an id from before the delete then edits or removes the
 * wrong remark, and nothing looks wrong afterwards — the right NUMBER of
 * remarks remain, with the wrong words in them.
 */
describe('a remark keeps its identity while its neighbours change', () => {
    const owner = () => personal().authorId;
    const season = () => currentSeason().id;

    it('removes the one asked for, not the one in that position', () => {
        const a = addRemark(owner(), 'p_mendoza', 'strength', 'First', season());
        const b = addRemark(owner(), 'p_mendoza', 'strength', 'Second', season());
        const c = addRemark(owner(), 'p_mendoza', 'strength', 'Third', season());

        // Ids captured BEFORE the delete, which is the whole point: a component
        // holds them across a render.
        expect(removeRemark(owner(), 'p_mendoza', a.id)).toBe(true);
        expect(removeRemark(owner(), 'p_mendoza', c.id)).toBe(true);

        const left = remarksFor(owner(), 'p_mendoza').map(r => r.text);
        expect(left).toEqual(['Second']);
        expect(b.id).toBeTruthy();
    });

    it('rewords the one asked for after its neighbours have gone', () => {
        addRemark(owner(), 'p_mendoza', 'note', 'Doomed', season());
        const keep = addRemark(owner(), 'p_mendoza', 'note', 'Keep me', season());

        removeRemark(owner(), 'p_mendoza', remarksFor(owner(), 'p_mendoza')[0].id);
        expect(updateRemarkText(owner(), 'p_mendoza', keep.id, 'Reworded')).toBe(true);

        expect(remarksFor(owner(), 'p_mendoza').map(r => r.text)).toEqual(['Reworded']);
    });

    it('keeps the same id through a rewording, because it is the same remark', () => {
        const r = addRemark(owner(), 'p_mendoza', 'weakness', 'Thin', season());
        updateRemarkText(owner(), 'p_mendoza', r.id, 'Thin for the position');

        const [only] = remarksFor(owner(), 'p_mendoza');
        expect(only.id).toBe(r.id);
        expect(only.text).toBe('Thin for the position');
    });

    it('gives every remark a different id', () => {
        const ids = ['One', 'Two', 'Three', 'Four']
            .map(t => addRemark(owner(), 'p_mendoza', 'note', t, season()).id);
        expect(new Set(ids).size).toBe(4);
    });

    it('still finds a remark written before ids existed', () => {
        // Written straight into the store in the old shape — no `i` — because
        // that is what is sitting in every browser that has used this app.
        const path = `evaluations/p_mendoza/remarks`;
        store.write([{
            collection: path,
            id: owner(),
            doc: { [`s_${season()}`]: { s: [{ t: 'Old shape', a: 1 }] } },
        }]);

        const [old] = remarksFor(owner(), 'p_mendoza');
        expect(old.text).toBe('Old shape');
        // A positional handle, and it still works — then the rewrite gives it
        // an id, which is how a document converts with no migration pass.
        expect(updateRemarkText(owner(), 'p_mendoza', old.id, 'Converted')).toBe(true);

        const [now] = remarksFor(owner(), 'p_mendoza');
        expect(now.text).toBe('Converted');
        expect(now.id).not.toContain(':');
    });
});
