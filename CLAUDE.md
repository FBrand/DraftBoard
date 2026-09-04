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
2. **Scouting** — personal rankings, ✓/✗/? tags, consensus-vs-personal comparison
3. **Draft** — the original live board (this is the app's current core)
4. **UDFA** — undrafted free agent signings, priority targets
5. **Roster Construction** — 53-man depth chart, practice squad/IR, specialist alignment

### Actual build status (verify against code before trusting any doc, including this one)

- **Stage 3 (Draft) — done.** `useDraftState.js` (central state/undo/pick
  tracking), `CenterBoard.jsx` (grid), `LeftPanel.jsx`/`RightPanel.jsx`/
  `BottomPanel.jsx`, live sync via `ESPNProvider.js` + `services/DraftService.js`.
- **Stage 5 (Roster) — substantially built,** and moving fast. `RosterView.jsx`
  + `utils/rosterState.js` implement full drag-and-drop 53-man/practice-squad/
  IR/cuts management, Ourlads auto-fetch, CSV import/export, position config.
  This is *not* a minimal skeleton — treat it as near-parity with Draft.
- **Stage 4 (UDFA) — folded into Roster's "Sign Player" flow** rather than
  being a distinct stage/view. `UnrankedModal.jsx` has a `postdraft`/`roster`
  mode (see `mode={(currentPick || 1) > 257 ? 'postdraft' : 'draft'}` in
  `App.jsx`) instead of its own priority-targets UI.
- **Stages 1 (FA) and 2 (Scouting) — not started.** No FA budget tracking or
  personal scouting-tag code exists anywhere in `src/`.
- **App navigation is a 2-tab switcher** in `App.jsx` (`view: 'draft' | 'roster'`),
  not the 5-stage tab shell `ROADMAP.md` describes. If/when building that
  shell, Draft and Roster are the two stages closest to done; UDFA needs to be
  split out of Roster's sign-player flow into its own view.
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
