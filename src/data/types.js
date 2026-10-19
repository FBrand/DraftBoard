/**
 * The shapes that have actually caused bugs here.
 *
 * Not a type system and not an attempt at one: JSDoc that an editor and
 * `checkJs` can read, on the four shapes where getting it wrong has cost real
 * time in this codebase. Each one below is a bug that happened.
 *
 * The point is the places where a value changed shape and nothing said so:
 * `cuts` holding slots where names were expected, a stage read returning a
 * document where a string was, a pick number that is sometimes the word
 * "UDFA". Those are exactly what a type would have caught and a test only
 * caught afterwards.
 *
 * @module data/types
 */

/**
 * A store the repository can talk to.
 *
 * `loadSync` is the one that matters: it is OPTIONAL, and a remote adapter
 * must not have it. Every synchronous read in the app is served by
 * localStorage's ability to answer instantly, and its absence is what forces
 * callers onto `ready()` rather than letting them quietly read nothing.
 *
 * @typedef  {object} Adapter
 * @property {string} name
 * @property {(collection: string) => Promise<Record<string, object>>} load
 * @property {(collection: string) => Record<string, object>} [loadSync]
 * @property {(collection: string, id: string, doc: object) => Promise<void>} set
 * @property {(collection: string, id: string) => Promise<void>} remove
 * @property {(collection: string, changes: Change[]) => Promise<void>} [commit]
 * @property {(collection: string) => Promise<void>} [clear]
 */

/**
 * One document in a batch. `doc: null` is a deletion — not a document whose
 * fields are all empty, which is a distinction the commit path depends on.
 *
 * @typedef  {object} Change
 * @property {string} id
 * @property {object|null} doc
 */

/**
 * One player on one board: an analyst's placement of him.
 *
 * `round` has three states, not two. A number is a placement. `null` usually
 * means the analyst has said nothing and the rankings file's own placement
 * stands. But it can also mean he took the placement OFF, and `cleared` is
 * what tells those apart — without it, "clear evaluations" wrote a null round,
 * the ranking read it as silence, and the file's placement came straight back.
 *
 * `position` is this board's read of him, not a fact about him: name and
 * school are the same everywhere, position is an opinion and boards disagree.
 *
 * Total rank and position rank are deliberately absent. They are derived from
 * round, tier and `withinGroup`, so they cannot collide or contradict the
 * board.
 *
 * @typedef  {object} BoardEntry
 * @property {string|null} playerId   registry id; a name is not an identity
 * @property {string} name
 * @property {string} position        this board's opinion
 * @property {string} school
 * @property {number|null} round
 * @property {number|null} tier
 * @property {number|null} withinGroup  float, so a move writes one player
 * @property {boolean} [cleared]      deliberately unplaced, not merely silent
 * @property {'like'|'avoid'|'monitor'|null} tag
 * @property {string} updatedAt
 */

/**
 * A player standing somewhere on a depth chart.
 *
 * `arrival` is how he GOT here — FA, UDFA, `24/1` — and it has to survive
 * every move: rebuilding a slot from its name alone stripped it, so a player
 * dragged to the cut panel and back came home a plain veteran.
 *
 * "IR" appears here as an arrival and is really a status, which is why coming
 * off injured reserve clears it and clears nothing else.
 *
 * Cuts and injured reserve hold these, NOT bare names. They held names once,
 * and the membership tests written against that shape went on compiling and
 * silently matching nothing.
 *
 * @typedef  {object} Slot
 * @property {string} name
 * @property {'53'|'ps'|'r'|'ir'|'cut'} zone
 * @property {string|null} [arrival]
 */

/**
 * A selection, or a signing that was never a selection.
 *
 * `pickNumber` is a number for a real pick and the string "UDFA" for an
 * undrafted signing — a label, not a slot. Reading it as a number is how a
 * projected round got printed on a roster card as if it were history.
 *
 * @typedef  {object} DraftPick
 * @property {string} name
 * @property {string} position
 * @property {number|string} pickNumber
 * @property {boolean} [draftedByUs]
 * @property {string} [team]
 */

export {};
