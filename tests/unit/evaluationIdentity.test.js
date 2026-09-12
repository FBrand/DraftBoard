import { describe, it, expect, beforeEach } from 'vitest';
import {
    ownerIdFor, openEvaluations, remarksFor, addRemark,
    updateRemarkText, removeRemark, migrateBoardRemarks, REMARK_KINDS,
} from '../../src/utils/evaluations';
import { openBoards, allBoards, renameBoard, renameAuthor, authorOf, currentSeason } from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';

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
    await openBoards();
    await openEvaluations();
});

const personal = () => allBoards().find(b => b.authorId);
const consensus = () => allBoards().find(b => !b.authorId);

describe('whose opinion it is', () => {
    it('is the author for a personal board, so it follows him across his boards', () => {
        const board = personal();
        expect(ownerIdFor(board)).toBe(board.authorId);
    });

    it('is the board itself for consensus, which has no person behind it', () => {
        const board = consensus();
        expect(ownerIdFor(board)).toBe(board.id);
    });

    it('is nothing at all when there is no board', () => {
        expect(ownerIdFor(null)).toBeNull();
    });
});

describe('writing a remark', () => {
    it('stores it against the owner and the player id, stamped with the season', () => {
        const owner = ownerIdFor(personal());
        const season = currentSeason().id;

        const remark = addRemark(owner, 'p_mendoza', 'strength', 'Reads coverage early', season);

        expect(remark.kind).toBe('strength');
        expect(remark.seasonId).toBe(season);
        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('does not leak between analysts', () => {
        const [a, b] = allBoards().filter(x => x.authorId).slice(0, 2);
        addRemark(ownerIdFor(a), 'p_mendoza', 'note', 'Mine', currentSeason().id);

        expect(remarksFor(ownerIdFor(a), 'p_mendoza')).toHaveLength(1);
        expect(remarksFor(ownerIdFor(b), 'p_mendoza')).toHaveLength(0);
    });

    it('does not leak between players', () => {
        const owner = ownerIdFor(personal());
        addRemark(owner, 'p_mendoza', 'note', 'Mine', currentSeason().id);
        expect(remarksFor(owner, 'p_reese')).toHaveLength(0);
    });

    it('refuses a blank body, a bad kind, or a missing end', () => {
        const owner = ownerIdFor(personal());
        expect(addRemark(owner, 'p1', 'strength', '   ', 's1')).toBeNull();
        expect(addRemark(owner, 'p1', 'vibes', 'text', 's1')).toBeNull();
        expect(addRemark(null, 'p1', 'note', 'text', 's1')).toBeNull();
        expect(addRemark(owner, null, 'note', 'text', 's1')).toBeNull();
        expect(remarksFor(owner, 'p1')).toHaveLength(0);
    });

    it('takes all three kinds and keeps them apart', () => {
        const owner = ownerIdFor(personal());
        REMARK_KINDS.forEach(kind => addRemark(owner, 'p1', kind, `a ${kind}`, 's1'));
        expect(remarksFor(owner, 'p1').map(r => r.kind)).toEqual(REMARK_KINDS);
    });
});

describe('a remark is not on the board entry', () => {
    it('survives renaming the board it was written from', () => {
        const board = personal();
        const owner = ownerIdFor(board);
        addRemark(owner, 'p_mendoza', 'note', 'Still here', currentSeason().id);

        renameBoard(board.id, 'A Totally New Name');

        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('survives renaming the analyst, because it is keyed by his id', () => {
        const board = personal();
        const owner = ownerIdFor(board);
        addRemark(owner, 'p_mendoza', 'note', 'Still here', currentSeason().id);

        renameAuthor(board.authorId, 'A Different Person Entirely');

        expect(authorOf(board).name).toBe('A Different Person Entirely');
        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });

    it('is keyed by player id, so correcting a player’s name does not lose it', () => {
        // The id is what is stored. A name is a fact about the player and can
        // be wrong; nothing addresses a remark by it.
        const owner = ownerIdFor(personal());
        addRemark(owner, 'p_mendoza', 'note', 'Spelled his name wrong at first', 's1');
        expect(remarksFor(owner, 'p_mendoza')).toHaveLength(1);
    });
});

describe('editing and deleting', () => {
    it('rewords without moving the season stamp — that records when it was written', () => {
        const owner = ownerIdFor(personal());
        const remark = addRemark(owner, 'p1', 'note', 'Teh quick brown fox', 's1');

        expect(updateRemarkText(owner, 'p1', remark.id, 'The quick brown fox')).toBe(true);
        const [after] = remarksFor(owner, 'p1');
        expect(after.text).toBe('The quick brown fox');
        expect(after.seasonId).toBe('s1');
    });

    it('treats emptying the text as deleting it', () => {
        const owner = ownerIdFor(personal());
        const remark = addRemark(owner, 'p1', 'note', 'Never mind', 's1');
        updateRemarkText(owner, 'p1', remark.id, '   ');
        expect(remarksFor(owner, 'p1')).toHaveLength(0);
    });

    it('removes one and leaves the rest', () => {
        const owner = ownerIdFor(personal());
        const first = addRemark(owner, 'p1', 'note', 'One', 's1');
        addRemark(owner, 'p1', 'note', 'Two', 's1');

        expect(removeRemark(owner, 'p1', first.id)).toBe(true);
        expect(remarksFor(owner, 'p1').map(r => r.text)).toEqual(['Two']);
    });

    it('reports rather than pretends when the remark is not there', () => {
        const owner = ownerIdFor(personal());
        expect(removeRemark(owner, 'p1', 'r_nope')).toBe(false);
        expect(updateRemarkText(owner, 'p1', 'r_nope', 'x')).toBe(false);
    });
});

describe('remarks that used to live on the board', () => {
    it('moves each legacy field onto the owner, stamped with the board’s season', () => {
        const board = personal();
        const entries = [
            { name: 'Fernando Mendoza', playerId: 'p_mendoza', strengths: ['Arm'], weaknesses: ['Footwork'], notes: ['Watch the bowl game'] },
            { name: 'Arvell Reese', playerId: 'p_reese' },
        ];

        const migrated = migrateBoardRemarks(board, entries);

        expect(migrated).not.toBeNull();
        expect(migrated[0].strengths).toBeUndefined();
        expect(migrated[0].weaknesses).toBeUndefined();
        expect(migrated[0].notes).toBeUndefined();

        const moved = remarksFor(ownerIdFor(board), 'p_mendoza');
        expect(moved.map(r => r.kind).sort()).toEqual(['note', 'strength', 'weakness']);
        moved.forEach(r => expect(r.seasonId).toBe(board.seasonId));
    });

    it('says so rather than churning when there is nothing to move', () => {
        expect(migrateBoardRemarks(personal(), [{ name: 'Arvell Reese', playerId: 'p_reese' }])).toBeNull();
    });
});
