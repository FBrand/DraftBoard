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
