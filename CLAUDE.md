# DraftBoard — Project Context

## What this app is, and why it exists

DraftBoard is a React/Vite single-page app that renders an NFL draft board as a
2D grid: positions as columns, draft rounds/tiers as rows. It was originally
built for the Kansas City Chiefs but is fully data-driven via CSV/TXT files in
`public/`, so it works for any team or custom mock.

**Primary purpose: a broadcast companion, not a consumer product.** It's built
as a content-enablement tool for **RGR Football** (Ryan Tracy + Daniel Hamrs,
NFL consultants/YouTubers) and similar experts. The app displays an expert's
live analysis/decision-making on stream; viewers follow along, ask questions,
and can mock along locally. When prioritizing work, the guiding question is:
**"does this help RGR put on a better show?"** — broadcast stability and
expert-facing polish outrank general cleanup.

The app runs entirely client-side (no backend), is deployed statically to
GitHub Pages via `.github/workflows/deploy.yml`, and is fully static —
`npm run build` output in `dist/` can be hosted anywhere with SPA fallback.

## The 5-stage roadmap (see `ROADMAP.md`)

`ROADMAP.md` is the authoritative long-term plan: an offseason workflow of five
sequential-but-revisitable stages.

1. **Free Agency** — FA signings, budget/contract tracking, board holes after FA
2. **Scouting** — building a board: rankings, tiers, ✓/✗/? tags, notes
   (note: `ROADMAP.md` frames this as "consensus-vs-personal comparison"; the
   built feature is deliberately *not* that — see the ranking model below)
3. **Draft** — the original live board (this is the app's current core)
4. **UDFA** — undrafted free agent signings, priority targets
5. **Roster Construction** — 53-man depth chart, practice squad/IR, specialist alignment

### Actual build status (verify against code before trusting any doc, including this one)

**All five stages now exist as their own tab** in `App.jsx`
(`fa | scouting | draft | udfa | roster`). Two shared primitives do the heavy
lifting rather than five bespoke UIs:

- **`CenterBoard.jsx`** — the board grid (position columns × round/tier rows).
  Used by Draft, UDFA and Scouting.
- **`DepthChartGrid.jsx`** — the depth-chart grid (position rows × 53-man/PS/
  reserve slots, drag-and-drop, IR and cuts). Used by Roster and Free Agency.

Stage notes:

- **Stage 3 (Draft) — done.** `useDraftState.js` (central state/undo/pick
  tracking), `DraftView.jsx`, `CenterBoard.jsx`, `LeftPanel.jsx`/
  `RightPanel.jsx`/`BottomPanel.jsx`, live sync via `ESPNProvider.js`.
- **Stage 5 (Roster) — substantially built.** `RosterView.jsx` +
  `utils/rosterState.js`: drag-and-drop 53-man/practice-squad/IR/cuts, CSV
  import/export, position config, and "Sync from FA/Draft/UDFA" which fills
  empty slots additively from the other stages (never overwrites).
- **Stage 4 (UDFA) — its own view** (`UdfaView.jsx`), reusing `CenterBoard`
  with its own chrome, no longer folded into Roster's sign-player flow.
- **Stage 1 (FA) — built** as a *needs-and-candidates snapshot*, deliberately
  not a signings/budget tracker: `FreeAgencyView.jsx` + `utils/faState.js`
  render the same depth-chart grid against a candidate pool, and read Roster's
  real depth chart read-only to compute needs.
- **Stage 2 (Scouting) — built** as a board *builder*, not a
  consensus-vs-personal comparison: `ScoutingView.jsx` +
  `utils/scoutingState.js` + `utils/boardRanking.js`. See the ranking model
  below — it's the part most easily broken by a well-meaning change.

### The player registry (`utils/playerRegistry.js`) — start here

**A player is a record with a stable id, not a name.** Until recently a player
*was* his name: every store keyed on it and every read re-derived identity by
fuzzy-matching. The same bug kept returning in new disguises — two men sharing
a name, a rename that had to be hand-migrated across three boards and the
matrix store, two analysts labelling one player at different positions. Each
was the same missing thing: nothing to point at.

`player_registry_v1` holds one record per player: `{ id, name, position,
school, aliases[], hidden }`. Ids are opaque and permanent — they survive a
rename, which any key derived from the name cannot.

Fuzzy matching still happens, because the data arrives as names, but it happens
**once**, in `resolveAll()`, when `useBoardRankings` loads the pool — never
again on the read path. Downstream stores key on `playerId`
(`scoutingState` entries, `athleticMatrix` rows), with the qualified name
match kept only as a fallback for rows written before ids existed.

A rename records the old identity as an **alias**, which is what stops the next
load — where the rankings file still supplies the old name — from creating a
second record. The registry is fully re-derivable from the files, so a clean
slate clears it and it rebuilds.

This is also the shape a backend needs: a document store keys on ids and cannot
fuzzy-match server-side, so keying on `playerId` is what makes that move a
change of adapter rather than a rewrite.

### Player identity: name + position + school (`utils/nameMatcher.js`)

**A name is not an identity.** Two players really do turn up in one draft class
with the same name, and a board that merged them would put one man's tape under
the other man's tier. Identity is name, position and school **together** — any
one of the three differing makes it a different player.

`findMatchingIndex(name, index, qualifier)` takes an optional third argument —
a player-ish `{ position, school }`, or a bare position string. When given, the
search only matches players it cannot tell apart from this one, and returns
"not found" rather than merging two people. **Only fields both sides declare
can discriminate**: rankings files carry no school column and some sources
spell positions their own way, so a field missing on either side is not
evidence of a difference.

Callers that know nothing beyond the name (scraped roster data, ESPN sync) pass
nothing and get the original name-only behaviour — do not "fix" those by
forcing a qualifier through, or legitimate matches across inconsistent sources
will start failing. The scouting/prospect/matrix paths all pass the player.

**But joining the rankings files is a different question**, and reusing the
identity rule there was a real bug. "Are these two different people?" is not
"is this the same man in two analysts' files": analysts label the same player
DL and EDGE all the time, so joining on position split one player into two,
which then collided as duplicate React keys and leaked list rows on every board
switch. `useBoardRankings.joinKeyFor()` joins on the **name**, except for a
name that appears more than once inside a *single* file — there the analyst
deliberately listed two people and position is doing real work.

Anything rendering a player list keys on name **and** position, never name
alone, since two players may legitimately share one.

### Every board carries every player

A player one analyst has ranked and another hasn't is **unranked** on the
second board, not missing from it — otherwise there is nowhere to disagree.
`useBoardRankings` builds the union of all three files (plus in-app additions)
and gives each board that whole pool, overlaying only its own file's `group`,
`overallRank` and favourite flag.

An unranked player has **no rank at all**, not the worst one. `rankBoard`
returns `overallRank: null` / `positionRank: null` for anyone with no tier, and
the UI shows `???`. Numbering him last would assert a judgement nobody made,
and would renumber the whole board the moment a name was jotted down mid-game.
`CenterBoard` gives them a `UR` row after the numbered rounds, and Scouting has
an `Unranked` filter (a separate axis from the tag filters — a player can be
liked *and* unplaced).

### Pick numbers are not always numbers (`utils/draftPhase.js`)

`DraftBoard_Picks.csv` records undrafted signings with the literal `UDFA` in
the pick column, and the card prints that where a drafted player prints
`PK 41`. So arithmetic on `pickNumber` is a trap, and it sprang: seeding the
pick counter did `Math.max(max, p.pickNumber)` across every signing, one
`Math.max(257, "UDFA")` returned `NaN`, `NaN` swallowed the rest, and
`(NaN || 1) > 257` reported a completed draft as not started — locking the UDFA
stage and counting zero UDFAs. Nothing outside `draftPhase.js` compares a raw
`pickNumber` against a number; use `isDraftPick`, `isUndraftedSigning`,
`isDraftComplete`, `highestDraftPick`.

### Adding and editing players (`utils/prospects.js` + `AddProspectsModal.jsx`)

The rankings CSVs are a snapshot; players declare late, rise late, or get
missed. `+ Add Players` in Scouting is the only in-app way to add a player who
isn't in any rankings file — every other "unranked player" button *disposes* of
a player (drafts/signs/rosters him) rather than creating one.

The split that matters: **name, position and school are base data**, stored in
`prospects_v1` and applied to every board's pool by `useBoardRankings` via
`applyProspects()`. Tier, tag, remarks and within-tier order stay per board in
`scoutingState`. The athletic matrix is global, because it measures the player
rather than an opinion of him.

**An added player is not a special kind of player.** He arrives *unranked*
(`group: null`, so he sorts last until someone places him) and carries no flag
marking his origin. Edit and delete work on every player, whoever he came from:
an in-app player is changed in place, while a rankings-file player gets an
**override** (`edits`) or a **hide** (`hidden`) recorded instead — the file is
re-read on every load and is not ours to rewrite. Corrected file players keep a
`sourceIdentity` pointing at the file's own identity, so a second correction
updates the same override rather than stacking a new one.

Both entry paths (typed rows, CSV import) land in the same verification step,
and **nothing is written until that step is submitted** — an import is a
proposal, not a bulk write. Collisions block submit and always offer the
already-existing player's card rather than dead-ending; filling in a different
position or school is itself a resolution.

### Player facts vs. board opinions

A **fact** is true whoever is looking, so it lives once on the registry record:
`isUdfa`, `draftYear`, `draftRound`, `draftPick`, `team`, `previousTeam`, and
the athletic-matrix scores (`athletic_matrix_v1` is retired —
`athleticMatrix.js` is now a facade over the record and migrates old rows).
Every fact is null when unrecorded, `isUdfa` included: null is "unknown",
false is "drafted".

An **opinion** is per board: `round`, `tier`, `withinGroup`, `tag`,
`strengths`/`weaknesses`/`notes`. Three analysts may disagree about all of
them; none can disagree about who drafted a player.

Facts are read-only on the scouting card — a prospect has not entered the
league, so a draft year means nothing while a board is being built. They are
written by the draft itself, by import, and by the sign/trade modal.

**`draftRound` is never derived from `draftPick`.** Compensatory picks make
`ceil(pick / 32)` wrong from round three on, and a confidently wrong round is
worse than a blank one. The live draft records year + overall pick and leaves
the round for import or hand entry.

### CSVs seed; storage is the truth

A rankings file creates a board's **initial state and nothing more**.
`scoutingState.seedBoard()` materialises every player's placement on first
load, marks the board `seeded`, and the file is never consulted again — editing
it later changes nothing until it is explicitly imported. Anything that writes
a board must preserve the `seeded` flag; dropping it makes the next load
re-seed from the file and throw the edit away.

### `withinGroup` is a float

A move writes **one number on one player**. Landing between two players takes
the midpoint of their values, so nobody else shifts and nobody else is written
— `moveToRank` returns a placement for the mover, not a new ordering for the
board. It used to rewrite all 328 entries for one drag, which also quietly
transcribed the file's order onto every untouched player.

Enough midpoint insertions at one spot will eat into float precision (~50);
the fix is renormalising that one tier with `spaceEvenly`, not changing the
model. Total rank is still counted off the ordering rather than stored, so it
cannot contradict the tiers or collide.

### Positional value is configurable (`utils/appSettings.js`)

It decides the order of players nobody has placed, which makes it an opinion —
it used to be a hardcoded list quietly shaping every board. It is **global, not
per board**: if analysts disagree about what a position is worth, that belongs
in where they place players, not in a hidden default that makes their untouched
boards differ. Edited via Scouting → Settings, alongside the Athletic Matrix
link.

### The board ranking model (read before touching ranks or groups)

Scouting's "Total Rank", "Position Rank" and "Round.Group" are **not** a
separate annotation layer sitting beside the board's own numbers — they are
the board's own parameters, the ones `CenterBoard` places cards by and that
the exported `group,name,position` CSV carries into the draft board and roster
import.

Only two things are stored per player (`utils/scoutingState.js`): the `group`
(tier) and `withinGroup` (position inside that tier). **Total rank and
position rank are derived**, never stored, by `utils/boardRanking.js`:

1. Subgroups are authoritative — everyone in `1.2` outranks everyone in `1.3`.
2. Inside a tier, the analyst's explicit order wins (set by dragging, or by
   typing a total rank).
3. Otherwise, positional value breaks the tie (`POSITION_VALUE`).

Consequences that are easy to regress and are covered by
`tests/scouting-params.spec.js`:

- A rank is a *position in an ordering*, so two players can never share one.
  Typing a rank is a **move** — the player takes that slot, adopts that slot's
  tier, and everyone between the old and new position shifts by one. It is
  never a bare assignment.
- Because both numbers are read off one ordering, they cannot disagree with
  each other or with where a card actually sits on the board.
- `CenterBoard` derives its subgroup row order by sorting the group labels,
  *not* by the order players arrive in — Scouting hands it players in rank
  order, and relying on arrival order silently scrambled the rows.
- `ROADMAP.md` also describes a **Normal vs. Focus view toggle** for the Draft
  board (Normal = hide drafted, collapse empty rows; Focus = show all,
  dim drafted). This exists as `isFocusMode` state in `App.jsx`/`CenterBoard.jsx`
  but the Normal-view filtering has historically been incomplete/partial —
  check current behavior in `CenterBoard.jsx` rather than assuming it's done.

## Long-term vision: Phase 6, collaborative sync (not started)

Beyond the 5 local-only stages, the long-term plan is to layer authentication
and real-time sync on top:

- **Two user types:** ~10 authenticated "expert" accounts (RGR and similar
  creators) who can host public boards and "run" a live draft that broadcasts
  state to followers; unauthenticated viewers who can watch/follow an expert's
  live board in real time, or build their own local-only mock.
- **Follow = real-time sync:** when an expert drafts a player, all followers'
  boards update instantly (WebSocket / Firebase Realtime DB style).
- **Needs a backend for the first time:** persistent DB for user profiles,
  board/roster definitions, pick history, session metadata; a real-time
  messaging layer; optionally an API for board CRUD and auth tokens.
- **No production ESPN live sync planned.** The existing `ESPNProvider.js` is
  explicitly a proof-of-concept and considered unsuitable for public/YouTube
  use — experts are expected to input picks manually to keep data-liability
  and governance simple.
- This phase is nested *on top of* Stages 1–5, not a replacement for them.
  When prioritizing: (1) anything that unblocks Stages 1–5 or improves the
  broadcast experience is high priority, (2) anything that lays groundwork for
  Phase 6 (board CRUD abstractions, player-card data shape, session
  serialization robustness) is medium priority, (3) pure cleanup/lint is low
  priority unless it threatens broadcast stability.

## Architecture

- **Stack:** React 19 + Vite 8, `html2canvas` for board JPEG export. No
  routing library, no state management library — state lives in
  `useDraftState.js` (draft) and `utils/rosterState.js` (roster), passed down
  via props.
- **Data-driven via `public/` files**, decoupling layout from code:
  - `rankings.csv` — `group,name,position`. `group` (e.g. `1.1`, `1.2`) creates
    horizontal round/tier breaks; empty `group` on a row inherits the last
    seen group.
  - `picks.txt` — comma-separated list of pick numbers your team owns.
  - `columns.txt` — comma-separated position column order (e.g. `QB, RB, WR, TE, ...`).
  - Rankings can be overridden at runtime via `?rankings=<url>` (must support CORS).
- **Live Sync is optional/modular by design:** if `src/services/` is missing,
  the Live Sync UI gracefully disables itself rather than breaking the core
  board. Activated via `?sync=true` URL param.
- **Session persistence:** `utils/sessionSerializer.js` serializes/deserializes
  full draft state (drafted players, pick order, undo history) to CSV. If
  `DraftBoard_Picks.csv` exists at bootstrap it auto-seeds initial state.
- **Board export:** `utils/exportBoard.js` uses html2canvas to produce a
  15.6MP JPEG snapshot of the board for sharing.
- **CenterBoard round/tier rendering:** parses the `group` column to build
  round headers (spanning vertically across their rows) and subgroup rows;
  in Normal View, once every player in a subgroup is drafted the row/round
  should collapse away (see "Actual build status" above re: completeness).
- **Sticky shelf concept** (see `STICKY_CONCEPT.md`, may or may not still be
  live in code — check `CenterBoard.jsx`): during a draft, undrafted leftovers
  from completed rounds "float" to a shelf above the current round, with a
  hard constraint that lower rounds must never visually sit below higher
  rounds on that shelf.
- **Roster (`RosterView.jsx` + `utils/rosterState.js`):** 53-man / practice
  squad / IR / cuts management with drag-and-drop, CSV import/export
  (format roughly `Phase,pos,slot1,slot2,...`, e.g. `O,QB,P Mahomes,J Fields,B Gray`
  — see `ROSTER_VIEW_SPEC.md`), Ourlads auto-fetch, depth-chart slot
  normalization (recent fix prevented reserve players from disappearing on
  reload — watch for regressions here since this area moves fast).

## Data pipeline (offline, not part of the running app)

Root-level Python scripts (`generate_rankings.py`, `generate_consensus.py`,
`scrape_roster.py`) and a `rankings/` folder of source-specific CSVs (ESPN,
PFF, CBS, etc.) build the consensus rankings files consumed by the app
(`rankings_consensus.csv`, `rankings_ryan.csv`, `rankings_dan.csv` in
`public/`). This consensus-aggregation pipeline is the current production
approach.

There is an older, separate prototype line of ~50 one-off scripts (outside
this repo, under `~/.gemini/antigravity/scratch/`) that digitized *photos of
physical hand-written draft boards* into ranking CSVs (slicing an image into
rows, OCR/coordinate extraction, reorganizing into `group,name,position`
format). These predate and were superseded by the consensus pipeline above —
treat them as historical/archived, not something to extend, unless a future
task specifically revives physical-board digitization.

## Other root-level docs worth knowing about (not yet consolidated)

- `ROSTER_VIEW_SPEC.md` — detailed design spec for Stage 5's roster UI (CSV
  format, offense/defense/specialist rows, depth order, reserve pool).
- `STICKY_CONCEPT.md` — design rationale for the sticky-shelf floating-card
  behavior during a live draft.
- `Ryan_Draft_Board_Grid.md` / `Ryan_Draft_Board_Master.md` — one user's
  (Ryan's) specific mock-draft layout/tier notes; Chiefs-focused, not
  genericized, useful mainly as a concrete example of real usage.
- These have been suggested (but not yet done) to consolidate into a single
  `ARCHITECTURE.md`/`CONTRIBUTING.md`.

## Working conventions

- Don't take doc claims (including this file, `ROADMAP.md`, and anything in
  a `Knowledgebase/`) at face value for "what's built" — Stage 5/Roster in
  particular has moved fast; re-verify against current code before reporting
  status.
- This repo is frequently worked from git worktrees. Worktrees share `.git`
  internals but not untracked/local files — so anything not committed here
  (scratch notes, chat exports, another tool's memory files) won't appear in
  other worktrees or the main checkout and vice versa.
