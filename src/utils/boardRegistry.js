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

/**
 * These three collections are tiny, and they were the last ones still writing
 * `createdAt` in full and stating their own id in the body — the rule every
 * other collection follows. Small, but a rule with an exception is a rule
 * somebody has to remember.
 */
const READ = {
    season: (id, doc) => (doc ? { ...seasonFields.fat(doc), id } : null),
    board: (id, doc) => (doc ? { ...boardFields.fat(doc), id } : null),
    author: (id, doc) => (doc ? { ...authorFields.fat(doc), id } : null),
};

const allOf = (collection, kind) => Object.entries(repository.docs(collection) ?? {})
    .map(([id, doc]) => READ[kind](id, doc))
    .filter(Boolean);

const oneOf = (collection, kind, id) => READ[kind](id, repository.get(collection, id));

/** Written without the id — the key says it — and with short field names. */
const write = (collection, fields, record) => {
    const { id, ...rest } = record;
    return repository.set(collection, id, fields.lean(rest));
};
import { prefixedId } from './ids';
import { seasonFields, boardFields, authorFields } from '../data/fieldNames';
import { DRAFT_YEAR } from '../constants';
import { boardStateKey } from './appStorage';
import { removeSeasonStages } from '../data/stageStore';
import { removeAllProspects } from '../data/prospectStore';
import { removeBoardEntries } from '../data/boardEntries';
import { removeChart, ALL_SCOPES } from '../data/depthChartStore';
import { removeDraft } from '../data/draftStore';
import { initialiseSeason, forgetSeason } from './seasonInit';

export const SEASONS = 'seasons';
export const AUTHORS = 'authors';

/**
 * Display names, readable by ANYBODY — unlike `authors`, which carries the
 * person's real email and must stay expert-only. See voiceName below.
 */
export const AUTHOR_NAMES = 'author_names';
export const BOARDS_COLLECTION = 'boards';

/**
 * Who may act as an expert. Existence is the permission — there is no flag
 * inside — and it is keyed by email because an invite has to exist before
 * its person does. See firestore.rules and utils/auth.js; nothing in this
 * module reads it to decide anything, it is written here only so the shipped
 * placeholders show up as experts who can be revoked.
 */
export const EMAIL2AUTHOR = 'email2author';

/**
 * A new id, checked against the collection it is joining.
 *
 * Boards, authors and seasons are a handful of records each and always loaded,
 * so the set is free to build. See utils/ids.js for why the check matters more
 * than the length.
 */
const COLLECTION_FOR = { b: BOARDS_COLLECTION, a: AUTHORS, s: SEASONS };
const newId = (prefix) => prefixedId(
    prefix,
    new Set(repository.all(COLLECTION_FOR[prefix] ?? '').map(d => d.id)),
);

/**
 * Loads the records every board question is answered from.
 *
 * A LOADER, and nothing else.
 *
 * It used to seed as well: finding no boards, it created a season, two
 * placeholder authors, three boards and two invites. That put the decision "is
 * this store empty" and the act "write my defaults into it" in one function,
 * and every silent-overwrite bug on this project came out of that pairing — a
 * client reading an unreachable store as an empty one and filling it in. The
 * shared project was found in exactly that state: boards pointing at authors
 * that did not exist, because half the writes were refused.
 *
 * Gating the seeding on the backend was the first attempt and it was the wrong
 * shape — the logic stayed here and gained a condition. Seeding is the seeder's
 * (scripts/seed/), and a local store is filled from what the seeder built
 * (data/hydrate.js) before anything renders.
 */
export async function openBoards() {
    await Promise.all([
        repository.ready(SEASONS),
        repository.ready(AUTHORS),
        repository.ready(BOARDS_COLLECTION),
        // Published names. One collection read, and without it every remark on
        // every player card reads "Unattributed" to anybody who is not an
        // expert — which is the audience.
        repository.ready(AUTHOR_NAMES),
    ]);
}

export function listSeasons() {
    // Sorted here rather than by the repository: the store's field is `y`, and
    // a query naming `year` would silently order by nothing.
    return allOf(SEASONS, 'season').sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
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
    // Read and sorted here rather than by the repository: the store's fields
    // are `r` and `s`, so a query naming `order` would order by nothing and a
    // filter on `seasonId` would match nothing.
    return allOf(BOARDS_COLLECTION, 'board')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .filter(b => season == null || b.seasonId === season);
}

/** Every board ever, newest season first — a player card reaches back here. */
export function allBoards() {
    const rank = new Map(listSeasons().map((s, i) => [s.id, i]));
    return allOf(BOARDS_COLLECTION, 'board').sort((a, b) => (
        (rank.get(a.seasonId) ?? 99) - (rank.get(b.seasonId) ?? 99) || (a.order ?? 0) - (b.order ?? 0)
    ));
}

export function boardById(id) {
    return oneOf(BOARDS_COLLECTION, 'board', id);
}

/** The board a `?board=` link means. Falls back to the first of the season. */
export function boardBySlug(slug) {
    const boards = listBoards();
    return boards.find(b => b.slug === slug) ?? boards[0] ?? null;
}

/**
 * A person, by id. The one lookup a caller needs to turn a remark's voice
 * into a name, without going through a board to get there.
 *
 * Null for an id nobody has a record for — a placeholder author on a project
 * seeded before that person existed, or an expert who has not signed in here.
 * Callers must label that case rather than showing a raw id.
 */
export function authorById(id) {
    return id ? oneOf(AUTHORS, 'author', id) : null;
}

/**
 * A voice's display name, readable by ANYBODY.
 *
 * `authors` is not world-readable and must not become so: the record carries
 * the person's real email, and this app is deployed to a public URL for named
 * people whose colleagues are also named people. A rules comment justified that
 * restriction with "nothing viewer-facing needs an author" — which was true
 * when it was written and stopped being true the moment the player card started
 * grouping remarks by author. Measured: every remark by every analyst rendered
 * as "Unattributed" to the entire audience, which is most of what the card is
 * for.
 *
 * So the NAME is published separately and the email never leaves `authors`.
 * Nothing sensitive is in here, no existing document changes visibility, and
 * there is nothing to migrate — an author record already written keeps its
 * email private, and its owner's next sign-in publishes his name.
 */
export function voiceName(id) {
    if (!id) return null;
    const published = repository.get(AUTHOR_NAMES, id)?.n;
    if (published) return published;
    // An expert reading his colleagues can see the author record itself, so he
    // gets a name even before they have published one.
    return authorById(id)?.name ?? null;
}

/** Loads the published names, so a synchronous read can answer for them. */
export const openAuthorNames = () => repository.ready(AUTHOR_NAMES);

export function authorOf(board) {
    return board?.authorId ? oneOf(AUTHORS, 'author', board.authorId) : null;
}

/**
 * A board in an archived season is a record of what somebody thought at the
 * time. Placements — the tier and the order — are frozen. Evaluations are not;
 * see the note at the top.
 */
export function isFrozen(board) {
    if (!board) return false;
    const season = oneOf(SEASONS, 'season', board.seasonId);
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

export function renameBoard(id, label) {
    const board = boardById(id);
    const next = String(label ?? '').trim();
    if (!board || !next || next === board.label) return false;
    // The slug is deliberately untouched: it is what existing links say.
    write(BOARDS_COLLECTION, boardFields, { ...board, label: next });
    return true;
}

const VISIBILITIES = new Set(['private', 'expert', 'public']);

/**
 * Changes who can see a board's ENTRIES (not the board record itself, which
 * is always metadata-visible — see firestore.rules' boardVisible()). Only
 * meaningful for a personal board: a shared (author-less) board is always
 * public regardless of what is stored here, enforced server-side too, so
 * this refuses to touch one rather than write a value nothing will honor.
 */
export function setBoardVisibility(id, visibility) {
    const board = boardById(id);
    if (!board || !board.authorId) return false;
    if (!VISIBILITIES.has(visibility) || visibility === board.visibility) return false;
    write(BOARDS_COLLECTION, boardFields, { ...board, visibility });
    return true;
}

export function renameAuthor(id, name) {
    const author = oneOf(AUTHORS, 'author', id);
    const next = String(name ?? '').trim();
    if (!author || !next || next === author.name) return false;
    write(AUTHORS, authorFields, { ...author, name: next });
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

    await write(SEASONS, seasonFields, season);
    if (outgoing) {
        await write(SEASONS, seasonFields, { ...outgoing, status: 'archived' });
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
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
    if (!previous) return { ok: false, reason: 'nothing-underneath' };

    const doomed = listBoards(outgoing.id);

    await Promise.all(doomed.map(async (b) => {
        await removeBoardEntries(b.id);
        await repository.remove(BOARDS_COLLECTION, b.id);
        // The pre-document blob, for a board that was never opened since.
        try { localStorage.removeItem(boardStateKey(b.id)); } catch { /* ignore */ }
    }));

    await removeSeasonStages(outgoing.id);
    // The prospect records too, which are no longer inside the stage blob.
    await removeAllProspects(outgoing.id);
    // Every scope this build can name — see removeChart. A season being
    // scrapped takes the official chart and this person's with it.
    await Promise.all(['rosterState', 'fa_state_v1'].map(stage => removeChart(stage, outgoing.id, ALL_SCOPES)));
    await removeDraft(outgoing.id);
    forgetSeason(outgoing.id);

    await repository.remove(SEASONS, outgoing.id);
    await write(SEASONS, seasonFields, { ...previous, status: 'current' });
    // The season being viewed has just been deleted, so move off it.
    setViewedSeason(previous.id);

    // Evaluations are deliberately left alone. They are stamped with the
    // season they were written in, not owned by it, and what you learned about
    // a player does not stop being true because the board is gone.
    return { ok: true, dropped: outgoing, now: previous, boardsRemoved: doomed.length };
}

export async function createBoard({ label, authorName = '', ownerId = null, visibility } = {}) {
    const name = String(label ?? '').trim();
    if (!name) return null;

    const season = currentSeason();
    if (!season) return null;

    let authorId = null;
    const author = String(authorName ?? '').trim();
    if (author) {
        const existing = allOf(AUTHORS, 'author').find(
            a => a.name.toLowerCase() === author.toLowerCase(),
        );
        if (existing) authorId = existing.id;
        else {
            // The ADAPTER decides an author's id, because only the backend
            // knows what one is. On Firebase an author IS the signed-in
            // person, so this is his uid and the record he already has —
            // which is why the write below only fills one in if it is
            // genuinely absent, rather than renaming him to whatever was
            // typed into this form. Locally there is no auth and an author
            // is a display label, so it is a fresh opaque id and several can
            // coexist.
            authorId = repository.newAuthorId(
                new Set(repository.all(AUTHORS).map(a => a.id)),
            ) ?? newId('a');
            if (!oneOf(AUTHORS, 'author', authorId)) {
                await write(AUTHORS, authorFields, { id: authorId, name: author });
            }
        }
    }

    const taken = new Set(allOf(BOARDS_COLLECTION, 'board').map(b => b.slug));
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;

    const board = {
        id: newId('b'),
        slug,
        label: name,
        authorId,
        ownerId: ownerId ?? null,
        // A personal board defaults to expert-only: scouting runs
        // August-March, and a board is work in progress for most of that —
        // public is the deliberate, later exception, not the default. A
        // shared (author-less) board has no owner to keep anything from, so
        // it stays 'public' regardless — the rules also enforce this
        // server-side (boardVisible()'s `a == null` short-circuit), this is
        // just so the stored value reads truthfully rather than relying on
        // a reader to know the override exists.
        visibility: visibility ?? (authorId ? 'expert' : 'public'),
        seasonId: season.id,
        // Boards made in the app have no file behind them — they are seeded
        // from whatever is imported into them, or start empty.
        rankingsFile: null,
        order: listBoards(season.id).length,
        createdAt: new Date().toISOString(),
    };
    await write(BOARDS_COLLECTION, boardFields, board);
    return board;
}

/**
 * Whether the season already has an author-less ("shared") board — the
 * guard for a "new consensus"-style action, so it offers/succeeds at most
 * once per season. Not specific to the literal consensus slug: ANY board
 * with no author is this kind, on purpose (see the file header) — this just
 * stops a second one being made by the guarded action, not by hand via
 * CreateBoardModal's own blank-author field, which stays general on purpose.
 */
export function hasSharedBoard(seasonId = currentSeason()?.id) {
    return listBoards(seasonId).some(b => !b.authorId);
}

/** `{collection, id, doc}` for commitMany — the lean-with-short-keys shape write() uses for one document. */
const leaned = (collection, fields, record) => {
    const { id, ...rest } = record;
    return { collection, id, doc: fields.lean(rest) };
};

/**
 * Claims an orphaned personal board for `ownerId` — the caller's own uid,
 * always; this takes it as a parameter rather than asking auth.js itself
 * because boardRegistry is imported by permissions.js, which auth.js also
 * feeds, and importing auth.js back here would close that into a cycle.
 * Same shape createBoard's own ownerId param already uses.
 *
 * Only the BOARD changes now. An author used to carry an ownerId of its own
 * and had to move with it — two documents, two owners, which is why this
 * uses commitMany and why splitting them was a real hazard. An author no
 * longer has one: the record IS the person, keyed by his uid, so there is
 * nothing about him left to claim. Board ownership stays separate on
 * purpose — whose board it is (authorId) and who is holding it (ownerId) are
 * different questions, and a board changing hands does not make anybody a
 * different person.
 *
 * An already-owned board is refused here with a reason rather than left to
 * the rules layer's silent deny, though the rules refuse it independently
 * too — this is a courtesy, not the security boundary. The rules also refuse
 * a non-null owner on a SHARED (no-author) board outright, structurally, not
 * just via the `!board.authorId` check below.
 */
export async function claimBoard(id, ownerId) {
    if (!ownerId) return { ok: false, reason: 'not-signed-in' };
    const board = boardById(id);
    if (!board) return { ok: false, reason: 'not-found' };
    if (!board.authorId) return { ok: false, reason: 'shared' };
    // A held board is refused unless the man holding it has been revoked —
    // ownership is never stripped when somebody loses access, so his boards
    // stay his until claimed, and this is what makes them claimable. Asked
    // from cache, like everything else here; the rules re-derive it against
    // live data and refuse independently. Somebody's own board answers
    // 'owned' too: he cannot be revoked and be asking.
    if (board.ownerId && !ownerRevokedLocally(board.ownerId)) return { ok: false, reason: 'owned' };
    await repository.commitMany([
        leaned(BOARDS_COLLECTION, boardFields, { ...board, ownerId }),
    ]);
    return { ok: true };
}

/**
 * Releases ownership back to orphaned. Only the current owner may — checked
 * against the caller-supplied `ownerId` the same way the rules check
 * request.auth.uid. Never hands a board directly to somebody else; per
 * BUGS.md that has to pass through orphaned first, so this only ever writes
 * null, never another uid. Only the board moves — see claimBoard() for why
 * the author no longer travels with it.
 */
export async function orphanBoard(id, ownerId) {
    if (!ownerId) return { ok: false, reason: 'not-signed-in' };
    const board = boardById(id);
    if (!board) return { ok: false, reason: 'not-found' };
    if (board.ownerId !== ownerId) return { ok: false, reason: 'not-owner' };
    await repository.commitMany([
        leaned(BOARDS_COLLECTION, boardFields, { ...board, ownerId: null }),
    ]);
    return { ok: true };
}

/**
 * Keeps the board list current while a page is open.
 *
 * `boards` is FOUR documents, so watching it costs about as little as
 * watching anything can — and it is the collection whose staleness actually
 * showed: ownership, visibility and the list itself all live here, all three
 * changed meaning recently, and none of them was refreshed after boot. A
 * board somebody else claimed, hid, or created went on reading as it had
 * been until a reload, which is exactly how claiming a board that looked
 * unowned came as a surprise.
 *
 * It also earns its keep twice over, because `write()` sends whole
 * documents built from the cached copy: a live cache is what stops a board
 * write being assembled from a stale one.
 *
 * Returns an unsubscribe. A no-op on a store that cannot push — the local
 * adapter cannot change behind the app's back, so there is nothing to hear.
 */
export function followBoards(onChange) {
    if (!repository.isLive()) return () => {};
    return repository.follow(BOARDS_COLLECTION, onChange);
}

/**
 * Loads the invite list into the cache, for deciding what to OFFER.
 *
 * Expert-only, because the rules are: any signed-in Google account may read
 * its own entry, and nobody reads the whole collection until he is an expert
 * himself. A viewer's read is refused, which the repository records as a
 * failed load rather than an empty one (store.readiness().failed) —
 * and `ownerRevokedLocally` below treats both the same way anyway, so a
 * refusal degrades to "don't know", not to "everybody is revoked".
 */
export function openInvites() {
    return repository.ready(EMAIL2AUTHOR);
}

/**
 * Drops the cached invite list so the next read fetches it again.
 *
 * Inviting and revoking go straight through the SDK in utils/auth.js rather
 * than the repository — they are single-document writes on a collection
 * nothing else stores through — so the cache here does not hear about them
 * and would keep answering with the list as it was at sign-in. Everything it
 * feeds is display (see ownerRevokedLocally), so a stale answer is a button
 * drawn wrongly rather than a wrong decision, but a button drawn wrongly for
 * the rest of the session is worth one re-read to avoid.
 */
export function invalidateInvites() {
    repository.invalidate(EMAIL2AUTHOR);
}

/**
 * Whether this uid's access has been revoked, answered from cache.
 *
 * The same question firestore.rules' `ownerRevoked()` asks, and deliberately
 * NOT the same answer: this one is for deciding whether to draw a button. The
 * rules decide whether the write lands, and they re-ask against live data
 * every time. Keeping the cheap copy here is what stops the expensive rules
 * branch being evaluated on speculative claims — it runs on real attempts
 * only — but nothing may ever substitute it for the real check. See the note
 * at the top of firestore.rules about canEdit().
 *
 * Every uncertain case answers FALSE, and that is the harmless direction: a
 * button that fails to appear hides an option until the next load, where a
 * button wrongly appearing would produce a permission error the person
 * cannot act on. Not loaded yet, load refused, an author with no stored
 * address, an author record that never got written — all of them mean "no
 * reason to think he is revoked".
 *
 * An EMPTY invite set counts as unknown rather than "nobody is invited". It
 * cannot be genuinely empty here: only an expert asks, and an expert has an
 * invite by definition, so empty means unloaded or refused.
 */
export function ownerRevokedLocally(ownerId) {
    if (!ownerId) return false;
    if (repository.loadFailed(EMAIL2AUTHOR)) return false;
    const invites = repository.docs(EMAIL2AUTHOR);
    if (!invites || !Object.keys(invites).length) return false;
    const email = oneOf(AUTHORS, 'author', ownerId)?.email;
    if (!email) return false;
    return !Object.prototype.hasOwnProperty.call(invites, String(email).trim().toLowerCase());
}

/**
 * Whether `byOwnerId` may claim this board — for the interface only.
 *
 * Three ways a personal board is up for grabs, and only the third is new:
 * nobody has ever claimed it, or whoever held it released it (both `ownerId`
 * null), or the man holding it has been revoked. A SHARED board is never
 * claimable — there is no owner to be, which the rules enforce structurally
 * via ownershipWouldBeSafe rather than trusting this.
 */
export function boardClaimableBy(board, byOwnerId) {
    if (!byOwnerId || !board?.authorId) return false;
    if (!board.ownerId) return true;
    if (board.ownerId === byOwnerId) return false;
    return ownerRevokedLocally(board.ownerId);
}

/**
 * Marks an author as revoked, or puts the mark back.
 *
 * INFORMATIONAL ONLY. Nothing anywhere decides access from this — the rules
 * never read it, and `isExpert()` asks about the email2author invite and
 * nothing else. It exists so the interface can say somebody was revoked
 * instead of having him silently vanish from the list, and so a record that
 * outlives its access still says what happened to it. Deleting the invite is
 * what revokes; this is the label on the result.
 */
export async function markAuthorDeactivated(authorId, deactivated = true) {
    const author = oneOf(AUTHORS, 'author', authorId);
    if (!author) return { ok: false, reason: 'not-found' };
    await write(AUTHORS, authorFields, { ...author, deactivated: deactivated || null });
    return { ok: true };
}

// orphanBoardsOf() and reassignBoardsTo() used to live here, and were
// deleted when revoking stopped rewriting boards.
//
// Releasing a revoked man's boards by setting ownerId to null, then handing
// back the unclaimed ones on reinstatement, was maintained state saying what
// the rules now derive: ownerRevoked(board.o) asks whether the owner is
// still invited, against live data, so nothing has to be rewritten for his
// boards to become claimable. Keeping ownership intact also means
// reinstating him restores his boards AND their visibility settings for
// free, and removes a two-write sequence that could half-apply — the invite
// delete landing while the board rewrite did not, leaving a man locked out
// with his boards still held and nothing to finish the job.
