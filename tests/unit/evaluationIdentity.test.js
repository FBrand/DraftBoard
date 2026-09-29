import { describe, it, expect, beforeEach } from 'vitest';
import {
    voiceOf, myVoice, openEvaluations, remarksFor, addRemark,
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
    it('is the author, and follows him across his boards', () => {
        const board = personal();
        expect(voiceOf(board)).toBe(board.authorId);
    });

    it('is nobody for consensus, because a board does not have opinions', () => {
        // This used to answer with the BOARD's own id, which made the key
        // space a union of two different kinds of thing with nothing to tell
        // them apart — and made a board the author of remarks people wrote.
        // A remark is a person's opinion. Consensus is derived and has no
        // person behind it, so there is no voice to attribute to it; what
        // anybody writes while looking at it is written in their own name.
        expect(voiceOf(consensus())).toBeNull();
    });

    it('is nothing at all when there is no board', () => {
        expect(voiceOf(null)).toBeNull();
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

describe('a remark is not on the board entry', () => {
    it('survives renaming the board it was written from', () => {
        const board = personal();
        const owner = voiceOf(board);
        addRemark(owner, 'p_mendoza', 'note', 'Still here', currentSeason().id);

        renameBoard(board.id, 'A Totally New Name');

        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('survives renaming the analyst, because it is keyed by his id', () => {
        const board = personal();
        const owner = voiceOf(board);
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
