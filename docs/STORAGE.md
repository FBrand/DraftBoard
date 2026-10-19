# Storage schema

What is stored, where, and what it costs. Measured on a cold boot of the
shipped 2026 season: 733 players, 328 prospects on each of three boards, a
91-man roster, the completed draft.

**Total: 164KB for one season.** It was 925KB before the trims below, and
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
> places to disagree. Ids are reattached on read. Key material inside document
> bodies is now **zero**.

> **Field names are one character in the store and full words in the app.**
> They were 40–45% of the three collections that hold nearly everything — more
> than the values. The rename lives in `data/fieldNames.js`, beside the stores
> rather than in the adapter, and every map is checked for bijection at module
> load: a duplicate short name does not throw, it writes one field over another
> and surfaces later as a player with somebody else's school.
>
> This has bitten twice, both times in code reading a collection *raw*:
> `draftStore.yearOf` read `season.year` on a document storing `y`, returned
> null, and the entire draft read as empty; and `firestore.rules` tested
> `ownerId` on documents storing `o`, which Firestore does not treat as false —
> it raises and denies everything, so no expert could write his own board.
> **Anything reading a mapped collection must go through its `fat()`.**

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

### `players` — 91KB, 733 documents, ~124 bytes each

The registry. One document per player, keyed by an opaque permanent id.

```
"p_gblwjors": { "n":"Tyquan Thornton", "p":"WR", "s":"Baylor",
                "t":"KC", "y":2022, "d":2, "k":50, "u":false,
                "c":1789434931720, "e":1789434932965 }
```

In the app that is `{ name, position, school, team, draftYear, draftRound,
draftPick, isUdfa, createdAt, updatedAt }` — plus `aliases[]`, `hidden`,
`previousTeam` and the two athletic-matrix scores when they have values.
Timestamps are epoch milliseconds; an ISO string spends 24 characters carrying
13 of fact.

`id` is **not** stored — it is the key. Null fields are not stored either;
absent and null are the same answer to every reader, and only the storage
disagreed. That was 55KB of the word "null".

**A draft pick is one of these fields.** See below.

### `boards/{boardId}/entries` — 18.5KB per board, 328 documents, **56 bytes each**

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

### `evaluations/{playerId}/remarks/{ownerId}` — one document per owner, per player

```
db_evaluations/p_a11989cf/remarks
  { "b_9f9330c8": { "s_1e66044d": {
        s: [{ t: "Natural thrower and a pro-ready timing…", a: 1789418428790 }],
        w: [ … ], n: [ … ] } } }
```

The player comes first because of the read the app performs: `allRemarksFor`
gathers what **everybody** has written about one player, and on a read-only card
that stack is the card's content. Under the player that is one collection read.

Season and kind are keys inside the document rather than more path levels.
Measured at a full season — 250 players scouted on five boards, 17,500 remarks —
splitting them out cost 183,750 characters of collection key against 8,250 here,
and bought nothing: nothing reads one kind of one season without wanting its
neighbours. It also means reads do not enumerate seasons, so scrapping a season
cannot make what you learned unreachable.

The owner is the **author**, and the board only for consensus, which has no
person behind it — a board is a snapshot of where somebody had a player at one
moment, while an evaluation is a running log that follows the analyst across
every season. That is why none of this sits under `/seasons`.

**A remark is `{ t, a }` in an array.** It carried a six-character id whose only
job was to find it inside that array; position does that, and dropping it saves
about 157,500 characters across 17,500 remarks.

It was briefly `[text, writtenAt]`, which is smaller still — and **Firestore
cannot store a nested array**. The emulator refused it outright: *"Nested arrays
are not supported"*. A map inside an array is the cheapest shape both stores
hold. Eight characters per remark is what that costs.

The cost of dropping the id, named rather than buried: a handle is an **index**,
so two browsers of the same analyst editing the same player at the same moment
could remove the wrong line. The whole document is rewritten on any change in
that case anyway, so the race already existed.

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
| whole store | 686 KB | **164 KB** |
| `db_players` | 185,846 | 90,839 |
| a board's entries | 36,926 | 18,539 |
| evaluations | 19,939 | 6,644 |
| a board entry | 305 B | 112 B |
| a player id | 38 chars | 10 chars |
| key material inside bodies | 125,736 B | 0 |
| picks collection | 210 KB | gone |

Four things got it there, in the order they were done:

1. **The migration layer went.** 802 lines that read addresses nothing writes.
   There is no live data, so nothing can.
2. **Ids are eight base36 characters**, unique because they are *checked*
   against the collection at mint time rather than long enough to be safe
   blind. −48,000.
3. **Field names are one character in the store.** They were 40–45% of these
   collections — more than the values. −80,000.
4. **Remarks are addressed, not described.** −3,600 here, −409,000 at scale.

## One season at full scale

Five boards, 400 prospects, 250 of them scouted to the standard of the richest
real evaluation — fourteen remarks each:

| | bytes |
|---|---|
| evaluations (17,500 remarks) | 1,647,000 |
| board entries (2,000) | 114,000 |
| players (700) | 86,800 |
| charts, draft state, boards, authors, seasons, setup | 15,558 |
| **one season** | **1,863,358** |

Against the 4,175,829 this started at: **55% less**, and **2.8 seasons** fit a
5 MiB quota where one did.

Evaluations are 88% of it, and the remark text itself is about two thirds of
that — roughly 1.1 MB of the 1.65 MB is what somebody actually typed. There is
no third round of this available.

## What the quota actually counts

Measured, not assumed: **5,242,638 characters** before `QuotaExceededError` —
5 MiB exactly, counted in characters rather than UTF-16 bytes. And a character
in a **key** costs the same as a character in a value: filling with 200-char
keys and 50-char values reached 5,242,750; with 5-char keys and 245-char values,
5,242,677. The same ceiling either way.

That was measured in Chromium. Firefox has historically counted its quota in
UTF-16 bytes, which would halve the character budget — if the deployment is
Firefox, this is worth re-measuring before deciding how many seasons to keep.
