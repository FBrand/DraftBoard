import { describe, it, expect, beforeEach } from 'vitest';
import {
    openBoards, listBoards, allBoards, boardById, boardBySlug,
    authorOf, renameBoard, renameAuthor, createBoard, currentSeason, listSeasons,
    startSeason, scrapSeason, viewedSeason, setViewedSeason, isFrozen,
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

/**
 * Seasons are a stack: start one on top, or pop the top one off.
 *
 * `startSeason` existed from the beginning and nothing ever called it, so
 * neither half of this had ever run. The rollback half matters more than it
 * looks — rolling over is one button at the time of year you are least sure
 * last season is finished, so there has to be a way back, and it has to lead
 * to exactly what was there rather than an approximation.
 */
describe('rolling a season over', () => {
    it('makes the new one current and archives the one it replaced', async () => {
        const before = currentSeason();
        const made = await startSeason(before.year + 1);

        expect(made.status).toBe('current');
        expect(currentSeason().id).toBe(made.id);
        expect(listSeasons().find(s => s.id === before.id).status).toBe('archived');
    });

    it('creates no boards — who is scouting this year is a decision', async () => {
        const made = await startSeason(currentSeason().year + 1);
        expect(listBoards(made.id)).toEqual([]);
    });

    it('opens on the season just started', async () => {
        const made = await startSeason(currentSeason().year + 1);
        expect(viewedSeason().id).toBe(made.id);
    });

    it('refuses a year that already exists, because the stack is ordered by year', async () => {
        const year = currentSeason().year;
        expect(await startSeason(year)).toBeNull();
        expect(listSeasons().filter(s => s.year === year)).toHaveLength(1);
    });

    it('refuses something that is not a year', async () => {
        for (const bad of ['', null, 'next', 12, 99999]) {
            expect(await startSeason(bad)).toBeNull();
        }
    });
});

describe('rolling back', () => {
    it('refuses when there is nothing underneath — a season stack always has one', async () => {
        const out = await scrapSeason();
        expect(out).toEqual({ ok: false, reason: 'nothing-underneath' });
        expect(currentSeason()).not.toBeNull();
    });

    it('drops the current season and makes the previous one current again', async () => {
        const first = currentSeason();
        await startSeason(first.year + 1);

        const out = await scrapSeason();

        expect(out.ok).toBe(true);
        expect(currentSeason().id).toBe(first.id);
        expect(listSeasons().map(s => s.id)).not.toContain(out.dropped.id);
    });

    it('takes the scrapped season’s boards and their work with it', async () => {
        const first = currentSeason();
        const made = await startSeason(first.year + 1);
        const board = await createBoard({ label: 'This Year', authorName: 'Alex' });
        localStorage.setItem(`scouting_board_v1__${board.id}`, '{"version":1,"entries":[{"name":"X"}]}');

        const out = await scrapSeason();

        expect(out.boardsRemoved).toBe(1);
        expect(boardById(board.id)).toBeNull();
        expect(localStorage.getItem(`scouting_board_v1__${board.id}`)).toBeNull();
        expect(listSeasons().map(s => s.id)).not.toContain(made.id);
    });

    it('leaves the season underneath exactly as it was', async () => {
        const first = currentSeason();
        const kept = listBoards(first.id).map(b => b.id).sort();
        const keptWork = `scouting_board_v1__${kept[0]}`;
        localStorage.setItem(keptWork, '{"version":1,"entries":[{"name":"Kept"}]}');

        await startSeason(first.year + 1);
        await scrapSeason();

        expect(listBoards(first.id).map(b => b.id).sort()).toEqual(kept);
        expect(localStorage.getItem(keptWork)).toContain('Kept');
    });

    it('moves off the season it just deleted', async () => {
        const first = currentSeason();
        await startSeason(first.year + 1);
        await scrapSeason();
        expect(viewedSeason().id).toBe(first.id);
    });
});

describe('looking at an archived season', () => {
    it('shows that season’s boards rather than the current one’s', async () => {
        const first = currentSeason();
        const made = await startSeason(first.year + 1);
        await createBoard({ label: 'New Year Board', authorName: 'Alex' });

        expect(listBoards().map(b => b.label)).toEqual(['New Year Board']);

        setViewedSeason(first.id);
        expect(viewedSeason().id).toBe(first.id);
        expect(listBoards().map(b => b.label)).toContain('Consensus');
        expect(listBoards().map(b => b.label)).not.toContain('New Year Board');
        expect(made.id).not.toBe(viewedSeason().id);
    });

    it('freezes its boards — a record of what somebody thought at the time', async () => {
        const first = currentSeason();
        await startSeason(first.year + 1);
        setViewedSeason(first.id);

        listBoards().forEach(b => expect(isFrozen(b)).toBe(true));
    });

    it('does not freeze the current season’s boards', () => {
        listBoards().forEach(b => expect(isFrozen(b)).toBe(false));
    });

    it('falls back to the current season when the stored one is gone', async () => {
        const first = currentSeason();
        const made = await startSeason(first.year + 1);
        setViewedSeason(made.id);
        await scrapSeason();

        expect(viewedSeason().id).toBe(first.id);
    });
});
