# Storage schema

What is stored, where, and what it costs. Measured on a cold boot of the
shipped 2026 season: 733 players, 328 prospects on each of three boards, a
91-man roster, the completed draft.

**Total: 287KB for one season.** It was 925KB before the trims below, and
686KB as recently as the picks store.

---

## The shape

Everything goes through `src/data/repository.js`, which stores **documents in
named collections**. A collection is a map of id to document. The interface is
Firestore's, narrowed to what this app does, so the backend is an adapter swap
— see `backend.js`.

`localAdapter` writes one localStorage key per collection: `db_<name>`, with
`/` folded to `__`, so `boards/b1/entries` becomes `db_boards__b1__entries`.

Two rules decide what a document holds.

> **The store does not have to look like the export.** Exports are rebuilt from
> the registry and the rankings files, so a stored document holds only what
> cannot be derived.

> **A document never states its own key.** The id is what it is filed under;
> writing it again costs bytes on every write forever and gives a rename two
> places to disagree. Ids are reattached on read. This removed 125KB.

---

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

| path | what | adopted |
|---|---|---|
| `players/{playerId}` | the registry — global, a player spans seasons | yes |
| `authors/{authorId}` | people — global, a person outlives a season | yes |
| `seasons/{seasonId}` | the season stack | yes |
| `boards/{boardId}` | board records: label, slug, season, owner | yes |
| `boards/{boardId}/entries/{playerId}` | one board's placements | **yes** |
| `evaluations/{authorId}__{playerId}` | remarks — deliberately global | flat, on purpose |
| `seasons/{seasonId}/charts/{stage}/rows/{rowId}` | depth-chart rows | decided, not adopted |
| `seasons/{seasonId}/charts/{stage}/bands/{band}` | reserve and cuts | decided, not adopted |
| `seasons/{seasonId}/picks` | — | **no such thing**, see below |
| `seasons/{seasonId}/draftState` | whose turn it is | decided, not adopted |
| `seasons/{seasonId}/stages/{base}` | the prospect pool and its like | decided, not adopted |
| `seasons/{seasonId}/setup` | the "already seeded" markers | decided, not adopted |

**Evaluations stay global on purpose.** They are stamped with the season they
were written in rather than owned by it — what you learned about a player does
not stop being true because the board is gone, and the player card reaches back
through every season to show it. Nesting them under a season would make that
read a fan-out over the whole stack.

The unadopted paths are recorded so the choice is made once. Everything
season-scoped still uses a flat collection with the season in the document key,
which is the same information in a less convenient place.

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

### `evaluations` — ~1,350 bytes per scouted player per board

Keyed `{ownerId}__{playerId}__{seasonId}__{s|w|n}` — the owner, the player,
the season and the kind are all in the **address**, and the document is a map
of short id to `[text, writtenAt]`.

```
evaluations/a_dan__p_delane__s_2026__s
  { "k3f9x2": ["Sticky man-cover corner", 1789408507998], … }
```

The owner is the **author**, not the board, and the board only for consensus,
which has no person behind it. A board is a snapshot of where somebody had a
player at one moment; an evaluation is a running log that follows the analyst
across every season he watches that player. That is also why these are not
nested under a season: the player card reaches back through every season, and
a season that has been scrapped must not take its remarks with it — so reads
scan by key prefix rather than looping over the seasons the registry knows.

It used to be one document per owner and player, holding every remark in one
array with the season and the kind spelled out on each. Of roughly 209 bytes
per remark, 116 said what the address can say once:

| | was | now |
|---|---|---|
| remark uuid | 46 B | 8 B (six base36 chars, unique among a dozen siblings) |
| `seasonId` on every remark | 52 B | in the address |
| `kind` spelled out | 18 B | in the address |
| the text itself | ~65 B | ~65 B |

Measured on the shipped season: **2,505 bytes per player per board → 1,349**.

Old documents are read as they are and split into the new addresses on the
first **write**. Deliberately not on read: converting on read would turn
opening a player card into a write, which is how a quota fills while somebody
is only looking.

**At scale.** One season with 5 boards, 400 prospects and 250 of them scouted
to the standard of the richest real evaluation — fourteen remarks:

| | count | was | now |
|---|---|---|---|
| evaluations | 1,250 | 3,782,501 | **1,956,251** |
| board entries | 2,000 | 307,436 | 307,436 |
| players | 400 | 68,331 | 68,331 |
| everything else | — | 17,561 | 17,561 |
| **one season** | | **4.0 MB** | **2.24 MB** |

Two such seasons now fit a 5MB quota where one did. After this, text is about
55% of what remains and the rest is close to intrinsic — there is no third
round of this available.

### `depth_rows` / `depth_bands` — 16KB, 54 documents

A depth chart as rows. One drag writes one row. A band document is its slots;
it used to carry the whole key, its left half and its right half — 111 of 219
bytes.

### `draft_state` — 186 bytes, one per season

```
{ scope, value: { currentPick, ourPicksLeft, remotePicks } }
```

Whose turn it is and which picks are ours. That is all the draft owns.

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

| | before | now |
|---|---|---|
| whole store, cold | 686 KB | **287 KB** |
| session export | 801 KB | 324 KB |
| board entry | 305 B | 112 B |
| depth band | 219 B | 72 B |
| evaluation (per player, per board) | 2,844 B | 1,349 B |
| key material inside document bodies | 125,736 B | 318 B |
| picks collection | 210 KB | gone |

The remaining 27KB the audit still counts as "name and school on documents" is
the `players` collection's own canonical copy. That is not duplication; it is
where the name lives.
