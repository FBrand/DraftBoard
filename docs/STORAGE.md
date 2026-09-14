# Storage schema

What is stored, where, and what it costs. Measured on a cold boot of the
shipped 2026 season: 733 players, 328 prospects on each of three boards, a
91-man roster, the completed draft.

**Total: 285KB for one season.** It was 925KB before the trims below, and
686KB as recently as the picks store.

---

## The shape

Everything goes through `src/data/repository.js`, which stores **documents in
named collections**. A collection is a map of id to document, addressed by a
**path**. The interface is Firestore's, narrowed to what this app does, so the
backend is an adapter swap — see `backend.js`.

### How localStorage holds it, and why that decides the schema

localStorage has exactly one write primitive: `setItem(key, wholeString)`.
There is no partial write and no addressing into a value. **The unit of write
is one key's entire value** — change one field and the whole string is
re-serialised.

That rule, not taste, is what settled the layout. Two earlier attempts:

1. **The path folded into the key** — `db_seasons__s_1__charts__rosterState__rows`.
   Fast, and it filled a storage inspector with `__`-joined strings
   indistinguishable from the composite document keys the data model had just
   got rid of.
2. **The hierarchy inside the value** — one key per root collection holding a
   tree. No `__`, and measured at a season's scale:

   | write | blob | time |
   |---|---|---|
   | one draft pick | `db_players` 147KB | 36.8 ms |
   | one remark | `db_evaluations` 2.0MB | **557.8 ms** |

   Half a second to type a note, because one document write re-serialised
   every evaluation in the season.

A localStorage key is an arbitrary string and may contain a slash — which
neither attempt used. So **one key per collection, and the key is the path**:
`db_evaluations/p_…/s/b_…/s_…`. Same scale, same measurement:

| write | time |
|---|---|
| one remark | **1.5 ms** |
| scouting a player (fourteen remarks) | 7.1 ms |
| one draft pick | 51.9 ms |

Both earlier layouts are brought forward on first read. Missing either means
the app comes up empty with every board and evaluation apparently gone.

The other backends are not bound by this: IndexedDB writes one record,
Firestore writes one **field**. The constraint is localStorage's alone.

### Two rules for what a document holds

> **The store does not have to look like the export.** Exports are rebuilt from
> the registry and the rankings files, so a stored document holds only what
> cannot be derived.

> **A document never states its own key.** The id is what it is filed under;
> writing it again costs bytes on every write forever and gives a rename two
> places to disagree. Ids are reattached on read. This removed 125KB — key
> material inside document bodies is now 270 bytes across the whole store.

## Paths

Collections nest where the data does. A path is chosen for three reasons, in
this order:

1. **A security rule is written against a path.** "An expert may write his own
   board" is one line about `boards/{id}/entries`; over a shared collection
   with a `boardId` field it is a predicate that must hold for every document
   a query might touch.
2. **Reading one thing reads one thing.** A flat collection means loading five
   seasons of everybody's placements and filtering in memory.
3. **The parent stops being half of every key.**

| path | what |
|---|---|
| `players/{playerId}` | the registry — global, a player spans seasons |
| `authors/{authorId}` | people — global, a person outlives a season |
| `seasons/{seasonId}` | the season stack |
| `boards/{boardId}` | board records: label, slug, season, owner |
| `boards/{boardId}/entries/{playerId}` | one board's placements |
| `evaluations/{playerId}/{kind}/{ownerId}/{seasonId}/{remarkId}` | one remark |
| `seasons/{seasonId}/charts/{stage}/rows/{rowId}` | depth-chart rows |
| `seasons/{seasonId}/charts/{stage}/bands/{band}` | reserve and cuts |
| `seasons/{seasonId}/stages/{base}` | the prospect pool and its like |
| `seasons/{seasonId}/setup/{season\|facts}` | the "already seeded" markers |
| `draft_state/{seasonId}` | whose turn it is |
| `seasons/{seasonId}/picks` | **no such thing** — see below |

Every one of these is adopted. There are no composite document ids left: a
document id is a player id, a row id, a stage name, or a six-character remark
id, and nothing anywhere splits a key apart to find its parts.

**Evaluations are not nested under a season**, even though the season is in
their path. They are stamped with the season they were written in rather than
owned by it — what you learned about a player does not stop being true because
the board is gone, and the player card reaches back through every season to
show it.

**`draft_state` is the one thing still keyed flat by season.** It is a single
small document per season, read only by exact id, so a path would buy a
collection holding one record.

---

## Collections

### `players` — 184KB, 733 documents, ~250 bytes each

The registry. One document per player, keyed by an opaque permanent id.

```
{ name, position, school, aliases[], hidden,
  isUdfa, draftYear, draftRound, draftPick, team, previousTeam,
  athleticMatrixTotal, athleticMatrixPosition,
  createdAt, updatedAt }          // epoch ms, not ISO
```

`id` is **not** stored — it is the key. Null fields are not stored either;
absent and null are the same answer to every reader, and only the storage
disagreed. That was 55KB of the word "null".

**A draft pick is one of these fields.** See below.

### `boards/{boardId}/entries` — 36KB per board, 328 documents, **112 bytes each**

One board's opinion of one player. It was 305 bytes.

```
{ position, round, tier, withinGroup, tag, updatedAt }
```

What is *not* here, and why:

- `boardId`, `playerId` — the path and the key.
- `name`, `school` — the registry's. A copy beside the id is a second answer
  that a rename leaves behind.
- `order` — a second ordering sitting beside the tiers and free to disagree
  with them. `boardRanking` never read it: it sorts by tier, `withinGroup`,
  source rank, positional value, then name. Read order is derived.
- `position` **stays**. It is an opinion, not a fact — two analysts labelling
  the same player DL and EDGE are not disagreeing about anything.

### `evaluations/{playerId}/{kind}/{ownerId}/{seasonId}` — one remark per document

```
db_evaluations/p_a11989cf…/n/b_9f9330c8…/s_1e66044d…
  { "zjp9ay": { "t": "Natural thrower and a pro-ready timing…", "a": 1789418428790 } }
```

No composite key anywhere in it. Every part of a remark's identity is something
you select **by** — the card wants one player's, a section wants one kind's, a
board wants one author's, the log wants one season's — so a key that always has
to be taken apart again was earning nothing.

The player comes first because of the read the app actually performs:
`allRemarksFor` gathers what *everybody* has written about one player, and on a
read-only card that stack is the card's content.

`{kind}` is `s`/`w`/`n`. The owner is the **author**, and the board only for
consensus, which has no person behind it — a board is a snapshot of where
somebody had a player at one moment, while an evaluation is a running log that
follows the analyst across every season. That is also why these are not nested
under a season.

**What it saves, and where it does not.** Each remark used to carry all three
itself:

| | was, per remark | now |
|---|---|---|
| remark uuid | 46 B | 8 B (six base36 chars, unique among siblings) |
| `seasonId` | 52 B | in the path |
| `kind` spelled out | 18 B | in the path |

116 bytes repeated on every remark, replaced by a ~133-byte key shared by the
remarks in that bucket — about 28 bytes each when a bucket holds five. **A
bucket holding one remark is a net loss**, paying 133 to save 116. It works
because a kind-and-season bucket usually holds several.

Old documents are read as they are and split on the first **write**. Converting
on read would turn opening a player card into a write, which is how a quota
fills while somebody is only looking.

### `seasons/{seasonId}/charts/{stage}/rows|bands` — 13KB per season

A depth chart as rows, one drag writing one row. `{stage}` is `rosterState` or
`fa_state_v1` — the 53-man roster and free agency's candidate board share the
shape, so the stage is a path level rather than smuggled into the row id.

A band document is its slots. It used to carry the whole key, its left half and
its right half: 111 of 219 bytes.

These were a shared `depth_rows` collection keyed `{season}__{stage}__{rowId}`,
and `readChart` gathered a chart by scanning it for a prefix. That is the test
for whether a composite key earns its place — if something has to scan the key
to collect a subset, the subset wanted to be a collection. Reading one roster
meant walking every roster of every season.

### `draft_state/{seasonId}` — 186 bytes, one per season

```
{ value: { currentPick, ourPicksLeft, remotePicks } }
```

Whose turn it is and which picks are ours. That is all the draft owns — the
selections themselves are facts on the players. The body no longer repeats the
season; that was the last document in the app stating its own address.

### `seasons`, `boards`, `authors`, `setup`, `stages` — under 2KB together

`setup` holds markers: that a season's stages were initialised, and that the
shipped player facts were laid over it. Both live in the **target** store rather
than in this browser, so the first client to arrive seeds and every client
after it reads the marker and does nothing.

---

## There is no picks collection

A pick used to be a document: who was taken, at which pick, by which club, in
which season. Every one of those is already a field on the player's registry
record, so the collection was a second place recording the same event — and the
two disagreed. The registry knew a draft outcome for 295 players; the picks
collection held 631.

A selection is written onto the player and read back by asking the registry who
entered the league in this season's year. `draftedByUs` is not stored at all: it
compares the pick's club to whose offseason this is, so a stored answer went
stale the moment the session team changed.

Three things this needed, all of them real bugs first:

- A pick can be somebody no rankings file has heard of. He is **registered**
  rather than dropped; dropping them cost 300 players.
- `applyPlayerFacts` refilled blanks on every load, so clearing a draft was
  undone on the next boot. It seeds once per season now, and only lays the 2026
  outcome over the season the app shipped with — a season started in the app
  drafts its own class.
- `hasDraft` asked the registry whether anyone was drafted, which the facts
  file answered yes to before anything had been. It asks the state document.

Saved 210KB.

---

## What it costs, all in

Measured on a cold boot of the shipped season:

| | before | now |
|---|---|---|
| whole store | 686 KB | **285 KB** |
| session export | 801 KB | ~324 KB |
| board entry | 305 B | 112 B |
| depth band | 219 B | 72 B |
| key material inside bodies | 125,736 B | **270 B** |
| picks collection | 210 KB | gone |

The 27KB the audit still counts as "name and school on documents" is the
`players` collection's own canonical copy. That is not duplication; it is where
the name lives.

## One season at full scale

Five boards, 400 prospects, 250 of them scouted to the standard of the richest
real evaluation — fourteen remarks each:

| | count | bytes |
|---|---|---|
| evaluations | 1,250 (3,750 collections, 17,500 documents) | 2,126,250 |
| board entries | 2,000 | 307,436 |
| players | 400 | 68,331 |
| charts, draft state, boards, authors, seasons, setup | — | 15,558 |
| **one season** | | **2.52 MB** |

Against a 5MB localStorage quota that is **two such seasons**, where the
original layout fitted one at 4.0 MB.

Evaluations are 84% of it, and 3,750 collection keys at ~133 characters are
about 490KB — **21% of evaluations storage is the key text**. That is the price
of having no composite key: the parts live in the path, repeated per collection
instead of per document. The shallower alternative is one collection per player
with `{kind}__{owner}__{season}__{remarkId}` as the document id — 400 keys
instead of 3,750, and a composite key back.
