import { describe, it, expect, beforeEach } from 'vitest';
import {
    openBoards, listBoards, allBoards, boardById, boardBySlug,
    authorOf, renameBoard, renameAuthor, createBoard, currentSeason, listSeasons,
} from '../../src/utils/boardRegistry';
import { repository } from '../../src/data/repository';

/**
 * Boards, authors and seasons as records rather than filenames.
 *
 * Replaces `seasons.spec.js` ("boards have ids, and only the personal ones
 * have an author", "renaming a board keeps its work and its links") and the
 * identity half of `identity.spec.js`.
 *
 * The load-bearing rule is that a board's IDENTITY and its LABEL are separate
 * things. Links say the slug, stored work says the id, and the label is just
 * what it is called this week — so renaming has to break neither.
 */
beforeEach(async () => {
    globalThis.resetStorage();
    repository.invalidate();
    await openBoards();
});

describe('the boards a fresh app comes up with', () => {
    it('gives every board an id, a slug and a season', () => {
        const boards = allBoards();
        expect(boards.length).toBeGreaterThan(0);
        boards.forEach(b => {
            expect(b.id).toBeTruthy();
            expect(b.slug).toBeTruthy();
            expect(b.seasonId).toBe(currentSeason().id);
        });
    });

    it('gives the personal boards an author and the consensus none', () => {
        const boards = allBoards();
        const consensus = boards.filter(b => !b.authorId);
        const personal = boards.filter(b => b.authorId);

        // Consensus is what everyone agrees on, so nobody wrote it.
        expect(consensus).toHaveLength(1);
        expect(personal.length).toBeGreaterThan(0);
        personal.forEach(b => expect(authorOf(b)?.name).toBeTruthy());
        expect(authorOf(consensus[0])).toBeNull();
    });

    it('is idempotent — opening twice does not make a second set', () => {
        const before = allBoards().length;
        return openBoards().then(() => expect(allBoards().length).toBe(before));
    });

    it('has exactly one current season', () => {
        expect(listSeasons().filter(s => s.status === 'current')).toHaveLength(1);
    });

    it('finds a board by its slug, which is what a link carries', () => {
        const board = allBoards()[0];
        expect(boardBySlug(board.slug).id).toBe(board.id);
    });

    it('falls back to the first board for a slug that means nothing', () => {
        // A link from an older season, or a typo. Showing the default board is
        // better than showing nothing and better than an error page.
        expect(boardBySlug('no-such-board').id).toBe(listBoards()[0].id);
    });
});

describe('renaming', () => {
    it('keeps the id, so stored work still points at the same board', () => {
        const board = allBoards().find(b => b.authorId);
        expect(renameBoard(board.id, 'Completely Different')).toBe(true);
        expect(boardById(board.id).label).toBe('Completely Different');
    });

    it('keeps the slug, so links written before the rename still open it', () => {
        const board = allBoards().find(b => b.authorId);
        const slug = board.slug;
        renameBoard(board.id, 'Completely Different');
        expect(boardBySlug(slug).id).toBe(board.id);
    });

    it('refuses an empty name rather than leaving a board with none', () => {
        const board = allBoards()[0];
        expect(renameBoard(board.id, '   ')).toBe(false);
        expect(boardById(board.id).label).toBe(board.label);
    });

    it('renames the analyst without touching his boards', () => {
        const board = allBoards().find(b => b.authorId);
        expect(renameAuthor(board.authorId, 'Somebody Else')).toBe(true);
        expect(authorOf(boardById(board.id)).name).toBe('Somebody Else');
        expect(boardById(board.id).label).toBe(board.label);
    });
});

describe('making a board', () => {
    it('lands in the current season and is listed there', async () => {
        const made = await createBoard({ label: 'Scout Board', authorName: 'Alex' });
        expect(made.seasonId).toBe(currentSeason().id);
        expect(listBoards().map(b => b.id)).toContain(made.id);
    });

    it('reuses an analyst who already exists rather than duplicating him', async () => {
        const first = await createBoard({ label: 'One', authorName: 'Alex' });
        const second = await createBoard({ label: 'Two', authorName: 'alex' });
        expect(second.authorId).toBe(first.authorId);
    });

    it('makes the slug unique, because a link that matches two boards is ambiguous', async () => {
        const first = await createBoard({ label: 'Big Board', authorName: 'Alex' });
        const second = await createBoard({ label: 'Big Board', authorName: 'Sam' });
        expect(second.slug).not.toBe(first.slug);
        expect(boardBySlug(first.slug).id).toBe(first.id);
        expect(boardBySlug(second.slug).id).toBe(second.id);
    });

    it('makes an authorless board when nobody is named — that is what consensus is', async () => {
        const made = await createBoard({ label: 'Group Board' });
        expect(made.authorId).toBeNull();
        expect(authorOf(made)).toBeNull();
    });

    it('refuses a board with no name', async () => {
        expect(await createBoard({ label: '  ' })).toBeNull();
    });
});
