/**
 * The season, the boards and the analysts the shipped data is about.
 *
 * This was `openBoards()`, in the app: it loaded the board records and, finding
 * none, created a season, two placeholder authors, three boards and two invites.
 * That put the decision "is this store empty" and the act "write my defaults into
 * it" in one function, which is where every silent-overwrite bug on this project
 * came from — a client reading an unreachable store as an empty one and filling
 * it in. The shared project was found in exactly that state, with boards pointing
 * at authors that did not exist because half the writes had been refused.
 *
 * So it lives here, in the seeder, which is the only thing that may decide what
 * a default is. The app loads what it finds and seeds nothing; a local store is
 * filled from the snapshot this produces, before anything renders.
 */
import { prefixedId } from '../../src/utils/ids.js';
import { repository } from '../../src/data/repository.js';
import { seasonFields, boardFields, authorFields } from '../../src/data/fieldNames.js';
import { DRAFT_YEAR } from '../../src/constants.js';
import {
    SEASONS, AUTHORS, AUTHOR_NAMES, BOARDS_COLLECTION, EMAIL2AUTHOR,
} from '../../src/utils/boardRegistry.js';

/**
 * The boards the app shipped with. `slug` is what old links and old storage keys
 * called them, so both keep working; everything else about a board can change.
 */
const INITIAL_BOARDS = [
    { slug: 'consensus', label: 'Consensus', author: null, rankingsFile: 'rankings_consensus.csv' },
    { slug: 'dan', label: 'Dan', author: 'Dan', rankingsFile: 'rankings_dan.csv' },
    { slug: 'ryan', label: 'Ryan', author: 'Ryan', rankingsFile: 'rankings_ryan.csv' },
];

/**
 * Writes them, into a store that must already be empty of boards.
 *
 * The caller is the seeder, which starts from nothing by construction — so there
 * is no "is it empty" check here at all. That check was the dangerous half of the
 * old arrangement and it does not belong to seeding; it belongs to whoever
 * decides to seed, and the seeder's answer is always yes.
 */
export async function seedInitialBoards() {
    // "seeded" marks the one season the shipped files are ABOUT. They hold the
    // 2026 class, the 2026 picks and the roster that produced — a later season
    // must not re-read them, or rolling over hands you last year's draft board
    // again and the new season is the old one wearing a different number.
    const createdAt = new Date().toISOString();
    const season = {
        id: prefixedId('s', new Set()), year: DRAFT_YEAR, status: 'current', seeded: true, createdAt,
    };

    const authors = [];
    const boards = [];
    const invites = [];
    const names = [];
    const taken = new Set();

    INITIAL_BOARDS.forEach((b, order) => {
        let authorId = null;
        if (b.author) {
            // A PLACEHOLDER author, deliberately not keyed by a uid: no Google
            // account exists for Dan or Ryan, so there is no uid to key one by.
            // The opaque id means `authorId == request.auth.uid` is never true
            // for one, so nobody can write in their voice — the correct outcome
            // for a placeholder, and the reason the shipped example is only ever
            // read.
            //
            // The mock invite alongside makes them show up as real experts in
            // the list, so they can be revoked like anybody else and their
            // boards taken over by whoever does the work. The address is on a
            // `.local` domain: RFC 6762 reserves it, so no Google account can
            // ever exist there and the mock can never become a way in.
            const email = `${b.author.toLowerCase()}@draftboard.local`;
            const id = prefixedId('a', taken);
            taken.add(id);
            authors.push({ id, name: b.author, email, createdAt });
            // And his name where anybody can read it. Without this the shipped
            // example evaluations — filed under Dan — render as "Unattributed"
            // for every viewer, which is the whole audience.
            names.push({ id, doc: { n: b.author } });
            invites.push({ id: email, doc: { invitedBy: 'seed', invitedAt: createdAt } });
            authorId = id;
        }

        const id = prefixedId('b', taken);
        taken.add(id);
        boards.push({
            id,
            slug: b.slug,
            label: b.label,
            authorId,
            // Who may WRITE it, as opposed to whose opinion it is. Null means
            // nobody has claimed it, which is every board until somebody signs
            // in — and the shipped boards are made before there is anyone to own
            // them.
            ownerId: null,
            seasonId: season.id,
            rankingsFile: b.rankingsFile,
            order,
            createdAt,
        });
    });

    const { id: seasonId, ...seasonRest } = season;
    await Promise.all([
        repository.set(SEASONS, seasonId, seasonFields.lean(seasonRest)),
        repository.commit(AUTHORS, authors.map(({ id, ...rest }) => ({ id, doc: authorFields.lean(rest) }))),
        repository.commit(BOARDS_COLLECTION, boards.map(({ id, ...rest }) => ({ id, doc: boardFields.lean(rest) }))),
        repository.commit(EMAIL2AUTHOR, invites),
        repository.commit(AUTHOR_NAMES, names),
    ]);

    return { season, boards, authors };
}
