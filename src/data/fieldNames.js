/**
 * Long names in the app, short names in the store.
 *
 * Measured across the three collections that hold nearly everything, **field
 * names were 40–45% of storage** — more than the data:
 *
 *     db_players     64,059 of 150,090   43%
 *     a board's entries  14,568 of 36,926   40%
 *     depth rows      3,150 of  7,064   45%
 *
 * `createdAt` and `updatedAt` alone cost 17,592 characters in the registry,
 * before a single value. JSON repeats every key on every document, and these
 * documents are small, so the names dominate them.
 *
 * So the store gets `p` and the app keeps `position`. The rename lives here,
 * beside the stores, rather than in the adapter: the adapter's job is to put a
 * document somewhere, and it should not know what a document means.
 *
 * **The cost is real and worth stating.** Storage stops being readable in a
 * devtools inspector — `{"p":"QB","r":1,"w":1}` — and that is how bugs have
 * actually been found on this project. `expand()` exists partly so that a
 * console can get a document back into English.
 *
 * Every map is checked at module load: a duplicate short name, or one that
 * collides with a field left unmapped, would silently drop data on write and
 * is the one mistake this file can make.
 */

/**
 * Builds a `{ lean, fat }` pair from a long → short map.
 *
 * Unmapped fields pass through unchanged, so adding a field without touching
 * the map costs bytes rather than correctness. That is the right way round.
 */
export function renamer(map, label) {
    const reverse = {};
    Object.entries(map).forEach(([long, short]) => {
        if (reverse[short]) {
            throw new Error(`${label}: "${short}" is the short name for both "${reverse[short]}" and "${long}"`);
        }
        reverse[short] = long;
    });
    // A short name that is also somebody's long name would round-trip into the
    // wrong field the moment that field went unmapped.
    Object.keys(map).forEach(long => {
        if (reverse[long] && reverse[long] !== long) {
            throw new Error(`${label}: "${long}" is both a long name and the short name for "${reverse[long]}"`);
        }
    });

    return {
        /** App shape → stored shape. */
        lean(doc) {
            const out = {};
            Object.entries(doc ?? {}).forEach(([k, v]) => { out[map[k] ?? k] = v; });
            return out;
        },
        /** Stored shape → app shape. */
        fat(doc) {
            const out = {};
            Object.entries(doc ?? {}).forEach(([k, v]) => { out[reverse[k] ?? k] = v; });
            return out;
        },
        map,
        reverse,
    };
}

/** A player's registry record. `id` is the key and is never in the body. */
export const playerFields = renamer({
    name: 'n',
    position: 'p',
    school: 's',
    aliases: 'l',
    hidden: 'h',
    sourceIdentity: 'q',
    isUdfa: 'u',
    draftYear: 'y',
    draftRound: 'd',
    draftPick: 'k',
    team: 't',
    previousTeam: 'v',
    athleticMatrixTotal: 'm',
    athleticMatrixPosition: 'o',
    createdAt: 'c',
    updatedAt: 'e',
}, 'player');

/**
 * One player on one board. `playerId`, `name` and `school` are absent by
 * design — the key says who, and the registry says the rest.
 */
export const entryFields = renamer({
    position: 'p',
    round: 'r',
    tier: 'i',
    withinGroup: 'w',
    cleared: 'x',
    tag: 'g',
    isFavorite: 'f',
    overallRank: 'a',
    updatedAt: 'e',
    // A board's own override of a measurement that normally lives on the
    // player record. Null on all 984 entries of the shipped season, which is
    // why their absence from this map went unnoticed.
    athleticMatrixTotal: 'm',
    athleticMatrixPosition: 'n',
}, 'entry');

/** A depth-chart row. `rowId` is the key. */
export const rowFields = renamer({
    label: 'l',
    slots53: 'c',
    phase: 'f',
    slots: 's',
    order: 'o',
}, 'row');

/** One slot in a row, or in the reserve and cuts bands. */
export const slotFields = renamer({
    name: 'n',
    zone: 'z',
    arrival: 'a',
    // Who he IS, not what he is called. A slot used to carry a name and
    // nothing else, so every read of the chart re-derived identity by fuzzy
    // matching and every reachability question ran through the matcher.
    playerId: 'i',
}, 'slot');

/** A season on the stack. `id` is the key. */
export const seasonFields = renamer({
    year: 'y',
    status: 't',
    seeded: 'd',
    createdAt: 'c',
}, 'season');

/** A board record — the placements live under it. `id` is the key. */
export const boardFields = renamer({
    slug: 'g',
    label: 'l',
    authorId: 'a',
    ownerId: 'o',
    seasonId: 's',
    rankingsFile: 'f',
    order: 'r',
    seeded: 'd',
    createdAt: 'c',
}, 'board');

/** A person. `id` is the key. */
export const authorFields = renamer({
    name: 'n',
    ownerId: 'o',
    createdAt: 'c',
}, 'author');
