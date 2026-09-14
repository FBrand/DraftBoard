# Storage schema

What is stored, where, and what it costs. Measured on the shipped 2026 season:
733 players, 984 board entries across three boards, 629 picks, a 91-man roster.

**Total: 531KB for one season.** It was 925KB before the trims below.

---

## The shape

Everything goes through `src/data/repository.js`, which stores **documents in
named collections**. A collection is a map of id to document. The interface is
Firestore's, narrowed to what this app does, so the backend is an adapter
swap — see `backend.js`.

`localAdapter` writes one localStorage key per collection: `db_<name>`, with
`/` folded to `__` so `boards/b1/entries` is a legal key.

> **The store does not have to look like the export.** Exports are rebuilt from
> the registry and the rankings files, so a stored document holds only what
> cannot be derived. Several fields below were removed on exactly that
> argument.

---

## Collections

### `players` — 153KB, 733 documents, ~200 bytes each

The registry. One record per human being the app has ever seen, across every
season and every board. **Not season-scoped**: a player drafted in 2026 is the
same player when he appears on a 2028 roster, which is the whole reason ids
exist.

```json
{ "id": "p_mu19eed31ih9mvy", "name": "Tyquan Thornton", "position": "WR",
  "school": "Baylor",
  "isUdfa": false, "draftYear": 2022, "draftRound": 2, "draftPick": 50,
  "team": "KC",
  "createdAt": 1789392351265, "updatedAt": 1789392352438 }
```

`name`, `school`, `draftYear/Round/Pick`, `team` and `previousTeam` are FACTS —
one answer, true everywhere. `position` here is his listed position; what a
board thinks he plays is on the board entry, because that is an opinion.

Both athletic-matrix scores were null on every one of the 733, so was
`previousTeam`; `aliases` was an empty array on all of them and `hidden` was
false on all of them. 75KB of a 246KB store spent writing down the absence of
things. Timestamps are epoch — nothing reads them, they are provenance, and an
ISO string spends 24 characters carrying 13 of fact.

`id` stays as a field here, unlike on board entries: the registry's id is read
all over the app off the record itself.

### `board_entries` — 216KB, 984 documents, ~225 bytes each

One document per player per board: where one analyst has placed him.

```json
{ "boardId": "b_mu19ee6rchozqp", "order": 0,
  "playerId": "p_mu19eesz26budu95",
  "name": "Fernando Mendoza", "position": "QB", "school": "Indiana",
  "round": 1, "withinGroup": 1, "updatedAt": 1789391336194 }
```

Filed under `<boardId>__<playerId>`.

- `round` + `tier` + `withinGroup` is the placement. `withinGroup` is a FLOAT
  so a move lands on the midpoint between two neighbours and writes one
  player instead of renumbering a tier.
- **Total rank and position rank are not stored.** They are derived from the
  placement, so they cannot contradict the board.
- `round: null` means the analyst has said nothing and the rankings file's
  placement stands. `cleared: true` means he took it OFF. Without that flag
  those two were the same and "clear evaluations" appeared to do nothing.
- `position` is this board's read of him and may differ per board.
- `name` and `school` are duplicated from the registry so an entry is legible
  on its own. **41KB.** Removing them means moving several name-based lookups
  onto `playerId` first — that refactor is the work, not the saving.

### `draft_picks` — 127KB, 629 documents, ~170 bytes each

What the draft did. A pick, not a copy of the player who was taken.

```json
{ "id": "s_mu19ee6qfne3s9__pick_1", "scope": "s_mu19ee6qfne3s9", "order": 0,
  "name": "Fernando Mendoza", "position": "QB",
  "pickNumber": 1, "team": "LV", "draftedByUs": false }
```

A numbered pick is filed by its number; an undrafted signing has none — "UDFA"
is a label, not a slot — so it is filed under the player.

`round` is deliberately absent: it is derived from `pickNumber`. The stored
round used to be the round somebody *projected* him in, which is how a player
who went undrafted got "R5" printed on his roster card.

`position` stays because a pick can be somebody the current rankings file has
never heard of, and then this record is all there is to show him with.

**41KB of `id` and `scope`** — the season id, twice, in every document.

### `depth_rows` — 18KB, 50 documents

A position row and the players standing in it, one document per row per stage
per season. Moving somebody at WR.Z writes WR.Z.

```json
{ "id": "s_…__fa_state_v1__O-WR.Z-0", "scope": "s_…__fa_state_v1", "order": 0,
  "rowId": "O-WR.Z-0", "label": "WR.Z", "slots53": 2, "phase": "offense",
  "slots": [ { "name": "Tyquan Thornton", "zone": "53", "arrival": "FA" } ] }
```

A slot holds `arrival` — how he got here, FA/UDFA/`24/1` — which must survive
every move. `"IR"` appears as an arrival and is really a status, which is why
coming off injured reserve clears it and nothing else.

### `depth_bands` — 1KB

Injured reserve and the cut panel, one document each per stage per season.
Flat lists with no per-player structure to collide over, so they are not split
further.

### `evaluations` — 15KB

Remarks, keyed `<ownerId>__<playerId>`. The owner is the AUTHOR for a personal
board and the board itself for consensus, which has no person behind it.
Stamped with the season they were written in. These outlive the board that
ranked the player — the one thing still editable on an archived season.

### `boards`, `authors`, `seasons` — ~1KB together

Identity. A board has an `id` (what stored work points at), a `slug` (what
links say), a `label` (what it is called this week), an `authorId`, an
`ownerId` (who may write it — null until somebody signs in), and a `seasonId`.
Renaming touches only the label.

### `setup` — the first-run marker

One document per season, recording that its stages have been set up. **In the
store, not in localStorage**: with a shared backend, a local marker means every
visitor decides the season was never initialised and seeds it again over
everybody's work.

### `draft_state` — <1KB

What is left of a draft once the picks are documents: `currentPick`,
`ourPicksLeft`, `remotePicks`.

### Not collections

`pending_writes_v1` (writes that have not reached the store yet — kept in
localStorage on purpose, since it is emphatically not the store that failed),
`viewed_season_v1`, `draft_board_view`, `draft_board_focus`,
`nfl_draft_live_sync`, `athletic_matrix_url`, and the app settings.

---

## Capacity

**~1.05MB per season** at 500 players. Against a 5MB localStorage quota that
fails somewhere in **season three to five**, and the failure is the app
refusing to save.

Trimming records helps and does not solve it. `players` and `board_entries` are
the bulk and both grow honestly. The structural answers are archiving old
seasons out of the browser, or a backend.

## Ids

`p_mu19eed31ih9mvy` — a type prefix, a base36 timestamp, and a random tail.
Long because they are minted with no coordination: any client can make one
without asking anything.

At this scale the timestamp half is near-identical across everything made in
one session, so it is mostly repetition — and each id is stored two or three
times per document. `p_` + 6 random base36 characters would be collision-safe
against 700 players (36⁶ = 2.2 billion) and would save ~30KB.

**Last on the list.** It means migrating every reference — entries,
evaluations, picks, the registry — for the worst saving-to-risk ratio of
anything here.

## What is left on the table

| change | saves | cost |
|---|---|---|
| Drop `id`/`scope` from `draft_picks` and `depth_rows` bodies | ~50KB | low, but `scope` is the season filter until collections carry the season |
| Drop `name`/`school` from `board_entries` | 41KB | **moving name-based lookups onto playerId** |
| Shorter ids | ~30KB | migrating every reference |
