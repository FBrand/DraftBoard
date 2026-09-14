# Storage schema

What is stored, where, and what it costs. Measured on a cold boot of the
shipped 2026 season: 733 players, 328 prospects on each of three boards, a
91-man roster, the completed draft.

**Total: 295KB for one season.** It was 925KB before the trims below, and
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
| `evaluations/{boardId}__{playerId}` | remarks — deliberately global | flat, on purpose |
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

### `evaluations` — 2.5KB per scouted player per board

Keyed `{boardId}__{playerId}`. The document is its remarks.

```
{ remarks: [ { id, kind, text, seasonId, createdAt } ] }
```

**This is the one that matters at scale.** A player scouted properly carries
about fourteen remarks, and inside one remark roughly 211 bytes carry 65
characters of actual note: a 40-character uuid, the 38-character season id
repeated on every remark, and a spelled-out `kind`.

Measured for one season with 5 boards, 400 prospects and 250 of them scouted to
that standard on every board:

| | count | bytes |
|---|---|---|
| evaluations | 1,250 | **3,782,501** |
| board entries | 2,000 | 307,436 |
| players | 400 | 68,331 |
| everything else | — | 17,561 |
| **one season** | | **4.0 MB** |

Evaluations are 91% of it. At that intensity **one season fills a 5MB quota**.
Three changes would roughly halve it — group remarks by season instead of
stamping each one (−742 B/doc), a short remark id (−476 B/doc), a single-char
`kind` (−140 B/doc) — taking the season to about 2.1MB. That is a shape change
with a migration, not a trim, and has not been done.

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
| whole store, cold | 686 KB | **295 KB** |
| session export | 801 KB | 324 KB |
| board entry | 305 B | 112 B |
| depth band | 219 B | 72 B |
| evaluation | 2,844 B | 2,505 B |
| key material inside document bodies | 125,736 B | 318 B |
| picks collection | 210 KB | gone |

The remaining 27KB the audit still counts as "name and school on documents" is
the `players` collection's own canonical copy. That is not duplication; it is
where the name lives.
