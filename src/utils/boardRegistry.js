/**
 * Seasons, the people who build boards, and the boards themselves.
 *
 * A board used to BE its name. `BOARDS = ['consensus', 'dan', 'ryan']` was the
 * list, and the storage key was `scouting_overlay_v1__dan` — so the label and
 * the key were one string. Rename an analyst, replace one, or add a fourth,
 * and the work is either stranded under a dead key or silently reattributed to
 * whoever inherits the name. It is the same mistake the player data made, one
 * level up.
 *
 * So three things that were fused into that one string are separated:
 *
 *   An AUTHOR is a person, and persists across seasons. "Dan's 2026 board" and
 *   "Dan's 2027 board" are two boards by one man.
 *
 *   A BOARD belongs to one season and, usually, one author. Its `label` is
 *   display text and can be changed freely, because nothing keys on it. Its
 *   `slug` is stable and only exists so a link like `?board=dan` keeps working
 *   after a rename.
 *
 *   A SEASON is what makes a board an artifact. When a season is archived its
 *   boards freeze: the placements are the record of where somebody had a
 *   player at the time, and history does not get edited. What stays editable
 *   is the evaluation — the strengths, weaknesses and notes — because what you
 *   know about a player keeps growing after the board that ranked him is done.
 *
 * The consensus board has no author. It is derived from the others rather than
 * written by a person, and inventing somebody called Consensus to own it would
 * make "who said this" a lie.
 */
import { repository } from '../data/repository';
import { DRAFT_YEAR } from '../constants';
import { boardStateKey } from './appStorage';
import { removeSeasonStages } from '../data/stageStore';
import { removeBoardEntries } from '../data/boardEntries';
import { removeChart } from '../data/depthChartStore';
import { removeDraft } from '../data/draftStore';
import { initialiseSeason, forgetSeason } from './seasonInit';

export const SEASONS = 'seasons';
export const AUTHORS = 'authors';
export const BOARDS_COLLECTION = 'boards';

const newId = (prefix) => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * The boards the app shipped with, and the shape the migration gives them.
 * `slug` is what old links and old storage keys called them, so both keep
 * working; everything else about a board can change afterwards.
 */
const INITIAL_BOARDS = [
    { slug: 'consensus', label: 'Consensus', author: null, rankingsFile: 'rankings_consensus.csv' },
    { slug: 'dan', label: 'Dan', author: 'Dan', rankingsFile: 'rankings_dan.csv' },
    { slug: 'ryan', label: 'Ryan', author: 'Ryan', rankingsFile: 'rankings_ryan.csv' },
];

export async function openBoards() {
    await Promise.all([
        repository.ready(SEASONS),
        repository.ready(AUTHORS),
        repository.ready(BOARDS_COLLECTION),
    ]);
    if (repository.all(BOARDS_COLLECTION).length) return;

    // "seeded" marks the one season the files in public/ are ABOUT. They hold
    // the 2026 class, the 2026 picks and the roster that produced — a later
    // season must not re-read them, or rolling over hands you last year's
    // draft board again and the new season is the old one wearing a different
    // number.
    const season = { id: newId('s'), year: DRAFT_YEAR, status: 'current', seeded: true, createdAt: new Date().toISOString() };
    const authors = [];
    const boards = [];

    INITIAL_BOARDS.forEach((b, order) => {
        let authorId = null;
        if (b.author) {
            const author = { id: newId('a'), name: b.author, createdAt: season.createdAt };
            authors.push(author);
            authorId = author.id;
        }
        boards.push({
            id: newId('b'),
            slug: b.slug,
            label: b.label,
            authorId,
            // Who may WRITE it, as opposed to whose opinion it is. Null means
            // nobody has claimed it, which is every board until somebody signs
            // in — and the shipped boards were made before there was anyone to
            // own them. It is here now because adding a field to live data is a
            // migration and adding it to a default is a line.
            ownerId: null,
            seasonId: season.id,
            rankingsFile: b.rankingsFile,
            order,
            createdAt: season.createdAt,
        });
    });

    await Promise.all([
        repository.set(SEASONS, season.id, season),
        repository.commit(AUTHORS, authors.map(a => ({ id: a.id, doc: a }))),
        repository.commit(BOARDS_COLLECTION, boards.map(b => ({ id: b.id, doc: b }))),
    ]);
}

export function listSeasons() {
    return repository.query(SEASONS, { orderBy: { field: 'year', direction: 'desc' } });
}

export function currentSeason() {
    return listSeasons().find(s => s.status === 'current') ?? null;
}

const VIEWED_KEY = 'viewed_season_v1';

/**
 * Which season you are LOOKING at, which is not the same as which season is
 * current.
 *
 * Only one season is writable — the current one — but an archived season is
 * still worth opening: it is the record of where everybody had a player at the
 * time, which is the whole reason boards freeze rather than being deleted.
 * Viewing one shows its boards, read-only.
 *
 * Falls back to the current season whenever the stored id names a season that
 * is gone, which is what happens after a rollback purges the one you were
 * looking at.
 */
export function viewedSeason() {
    let stored = null;
    try { stored = localStorage.getItem(VIEWED_KEY); } catch { /* ignore */ }
    const found = stored ? listSeasons().find(s => s.id === stored) : null;
    return found ?? currentSeason();
}

export function setViewedSeason(seasonId) {
    try {
        if (!seasonId) localStorage.removeItem(VIEWED_KEY);
        else localStorage.setItem(VIEWED_KEY, seasonId);
    } catch { /* ignore */ }
    return viewedSeason();
}

/** Boards of a season, in their display order. Defaults to the one being viewed. */
export function listBoards(seasonId = null) {
    const season = seasonId ?? viewedSeason()?.id ?? null;
    return repository
        .query(BOARDS_COLLECTION, { orderBy: { field: 'order' } })
        .filter(b => season == null || b.seasonId === season);
}

/** Every board ever, newest season first — a player card reaches back here. */
export function allBoards() {
    const rank = new Map(listSeasons().map((s, i) => [s.id, i]));
    return [...repository.all(BOARDS_COLLECTION)].sort((a, b) => (
        (rank.get(a.seasonId) ?? 99) - (rank.get(b.seasonId) ?? 99) || (a.order ?? 0) - (b.order ?? 0)
    ));
}

export function boardById(id) {
    return repository.get(BOARDS_COLLECTION, id);
}

/** The board a `?board=` link means. Falls back to the first of the season. */
export function boardBySlug(slug) {
    const boards = listBoards();
    return boards.find(b => b.slug === slug) ?? boards[0] ?? null;
}

export function authorOf(board) {
    return board?.authorId ? repository.get(AUTHORS, board.authorId) : null;
}

/**
 * A board in an archived season is a record of what somebody thought at the
 * time. Placements — the tier and the order — are frozen. Evaluations are not;
 * see the note at the top.
 */
export function isFrozen(board) {
    if (!board) return false;
    const season = repository.get(SEASONS, board.seasonId);
    return season?.status === 'archived';
}

/**
 * Whether what is on screen can be changed.
 *
 * An archived season is a record: the roster as it finished, the draft as it
 * happened, the boards as they were left. Opening one is worth doing — that is
 * why they are kept rather than deleted — and editing one is not, because
 * every number in it is an answer to "what did we think at the time".
 *
 * Evaluations are the exception and are handled separately; what you know
 * about a player keeps growing after the board that ranked him is done.
 */
/**
 * Whether the shipped files in public/ describe the season being viewed.
 *
 * They describe exactly one: the class, the picks and the roster of the year
 * the app was built around. Every later season starts empty and is filled by
 * importing, which is the only honest thing a new season can do.
 */
export function seasonIsSeeded() {
    // Explicitly false only on a season started in the app. A season written
    // before this field existed has no opinion and is the shipped one.
    return viewedSeason()?.seeded !== false;
}

export function isReadOnly() {
    const viewing = viewedSeason();
    return !!viewing && viewing.status !== 'current';
}

export function renameBoard(id, label) {
    const board = boardById(id);
    const next = String(label ?? '').trim();
    if (!board || !next || next === board.label) return false;
    // The slug is deliberately untouched: it is what existing links say.
    repository.set(BOARDS_COLLECTION, id, { ...board, label: next });
    return true;
}

export function renameAuthor(id, name) {
    const author = repository.get(AUTHORS, id);
    const next = String(name ?? '').trim();
    if (!author || !next || next === author.name) return false;
    repository.set(AUTHORS, id, { ...author, name: next });
    return true;
}

/**
 * Rolls the season over. The outgoing season's boards freeze and stay in
 * history. It creates NO boards: a new season starts empty and you make the
 * boards you want with createBoard, because who is scouting this year is a
 * decision, not something to infer from who scouted last year. Carrying last
 * year's placements forward would be worse still — a draft class is entirely
 * new players, so it would assert judgements about people nobody has watched.
 */
export async function startSeason(year) {
    const n = Number(year);
    if (!Number.isInteger(n) || n < 2000 || n > 2999) return null;
    // One season per year. Two seasons both called 2027 make "which board is
    // this" unanswerable, and the stack is ordered by year.
    if (listSeasons().some(s => s.year === n)) return null;

    const outgoing = currentSeason();
    const season = {
        id: newId('s'), year: n, status: 'current', seeded: false, createdAt: new Date().toISOString(),
    };

    await repository.set(SEASONS, season.id, season);
    if (outgoing) {
        await repository.set(SEASONS, outgoing.id, { ...outgoing, status: 'archived' });
    }
    // What the season starts with is seasonInit's decision, not this one's.
    initialiseSeason(season.id, { carryRosterFrom: outgoing?.id ?? null });

    // You are looking at the season you just started, not the one you left.
    setViewedSeason(season.id);
    return season;
}

/**
 * Makes a board in the current season.
 *
 * `authorName` is who is writing it. Passing none makes an authorless board,
 * which is what consensus is — derived rather than written by a person. An
 * author with that name is reused rather than duplicated, so the same analyst
 * keeps one identity across seasons and across boards.
 *
 * The slug is derived from the label and made unique, because `?board=` uses
 * it and two boards answering to one slug would make a link ambiguous. The
 * label itself is free to repeat and free to change; nothing keys on it.
 */
/**
 * Undoes a rollover.
 *
 * Seasons are a stack, and this is the pop. Rolling over is cheap to do by
 * accident — one button, at the point in the year when you are least sure the
 * last one is finished — so there has to be a way back, and it has to be a way
 * back to exactly what was there rather than an approximation.
 *
 * What it removes is only ever the CURRENT season: its boards and the work on
 * them. Everything archived is untouched, which is the whole point of
 * archiving it. The season it drops back to becomes current again, and its
 * boards unfreeze with their placements exactly as they were left — nothing
 * was rewritten when they froze, they were only closed to writing.
 *
 * Refuses when there is nothing underneath. A season stack with one season is
 * not a stack you can pop; scrapping it would leave the app with no season at
 * all, and every board belongs to one.
 */
export async function scrapSeason() {
    const outgoing = currentSeason();
    if (!outgoing) return { ok: false, reason: 'no-current-season' };

    const previous = listSeasons()
        .filter(s => s.id !== outgoing.id && s.status === 'archived')
        .sort((a, b) => b.year - a.year)[0];
    if (!previous) return { ok: false, reason: 'nothing-underneath' };

    const doomed = listBoards(outgoing.id);

    await Promise.all(doomed.map(async (b) => {
        await removeBoardEntries(b.id);
        await repository.remove(BOARDS_COLLECTION, b.id);
        // The pre-document blob, for a board that was never opened since.
        try { localStorage.removeItem(boardStateKey(b.id)); } catch { /* ignore */ }
    }));

    await removeSeasonStages(outgoing.id);
    await Promise.all(['rosterState', 'fa_state_v1'].map(stage => removeChart(stage, outgoing.id)));
    await removeDraft(outgoing.id);
    forgetSeason(outgoing.id);

    await repository.remove(SEASONS, outgoing.id);
    await repository.set(SEASONS, previous.id, { ...previous, status: 'current' });
    // The season being viewed has just been deleted, so move off it.
    setViewedSeason(previous.id);

    // Evaluations are deliberately left alone. They are stamped with the
    // season they were written in, not owned by it, and what you learned about
    // a player does not stop being true because the board is gone.
    return { ok: true, dropped: outgoing, now: previous, boardsRemoved: doomed.length };
}

export async function createBoard({ label, authorName = '', ownerId = null } = {}) {
    const name = String(label ?? '').trim();
    if (!name) return null;

    const season = currentSeason();
    if (!season) return null;

    let authorId = null;
    const author = String(authorName ?? '').trim();
    if (author) {
        const existing = repository.all(AUTHORS).find(
            a => a.name.toLowerCase() === author.toLowerCase(),
        );
        if (existing) authorId = existing.id;
        else {
            authorId = newId('a');
            await repository.set(AUTHORS, authorId, { id: authorId, name: author });
        }
    }

    const taken = new Set(repository.all(BOARDS_COLLECTION).map(b => b.slug));
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;

    const board = {
        id: newId('b'),
        slug,
        label: name,
        authorId,
        ownerId: ownerId ?? null,
        seasonId: season.id,
        // Boards made in the app have no file behind them — they are seeded
        // from whatever is imported into them, or start empty.
        rankingsFile: null,
        order: listBoards(season.id).length,
        createdAt: new Date().toISOString(),
    };
    await repository.set(BOARDS_COLLECTION, board.id, board);
    return board;
}
