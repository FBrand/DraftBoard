# DraftBoard — Project Roadmap

## Short-Term: Dual View Modes

### Overview
Two distinct board modes toggled by a button in the header:

| | **Normal View** (default) | **Focus View** (current) |
|---|---|---|
| Drafted players | Hidden | Shown (greyed out) |
| Empty rows | Collapsed away | Shown |
| Purpose | Clean "who's available" at a glance | Full board visibility during draft |

---

### Normal View Behaviour
- **No drafted cards rendered** — they are filtered out entirely
- **Empty rows removed** — if every slot in a subgroup row is drafted, the row disappears
- **Empty round sections collapse** — if an entire round is exhausted, the round label and its rows are removed
- Grid reflows naturally around the remaining players
- Result: a compact, scrollable availability board — no sticky logic needed

### Focus View Behaviour
- All players shown (drafted + undrafted)
- Drafted cards are dimmed/greyed
- Existing subgroup rows and round structure preserved
- The collapsing-round-strips feature (if retained) belongs here only

---

### Implementation Plan (Short-Term)

#### 1. View mode state
```js
// In App.jsx or a context
const [viewMode, setViewMode] = useState('normal'); // 'normal' | 'focus'
```

#### 2. CenterBoard filter logic
```js
// In Normal view:
const visiblePlayers = players.filter(p => !p.drafted);
// Rebuild allGroups and roundConfig from visiblePlayers only
// Empty rows and rounds vanish automatically — no extra code needed
```

#### 3. Toggle button
- In the board header / toolbar area
- Simple icon toggle: "grid" (normal) ↔ "eye" (focus)

#### 4. Revert CenterBoard sticky changes
- Remove the collapsing-round sentinel/strip machinery
- CenterBoard renders purely statically based on `viewMode`

---

## Mid-Term: 5-Stage Offseason App

### Stage Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  1: Free Agency  │  2: Scouting  │  3: Draft  │  4: UDFA  │  5: Roster  │
└──────────────────────────────────────────────────────────────────┘
```

Each stage has its own view, data model, and actions. Navigation between stages is linear but stages can be revisited.

---

### Stage 1 — Free Agency
**Goal:** Show needs and the candidates who could fill them  
- ✅ Seeded from last season's roster — the squad you actually carry in
- ✅ Position need chart, computed against the real roster
- ✅ Board shows remaining holes after FA
- ~~Contract value tracking per player~~ — **out of scope.** Cap and contract
  context is not something this tool tries to model; that conversation happens
  elsewhere. The stage is a needs-and-candidates snapshot, not a cap sheet.

### Stage 2 — Scouting
**Goal:** Rank and tag draft prospects before the draft  
- View/edit personal rankings per position
- Tag players: ✓ like, ✗ avoid, ? monitor
- ~~Compare consensus vs personal rank (value gap)~~ — dropped deliberately.
  Scouting *builds* boards; each analyst has their own board and player pool,
  so there is no single "personal vs consensus" axis to compare along.
- ~~Mock draft simulation mode~~ — **dropped, not wanted.**

**Proposed (mid-term): replace the board grid in Scouting with a grouped
list.** The board grid is the right shape for *drafting* (position columns ×
round rows, "who's left at each spot"). For *scouting* the natural unit is a
group of comparable players — by position, or by school when you're working
through one team's prospects. A grouped list would also give each player more
horizontal room for the evaluation fields the grid can't show.

⚠️ **Blocked on data, not UI.** Grouping by position works today. Grouping by
school does not: no school/college field exists anywhere in the app. The
rankings CSVs are `group,name,position` only, and `college` appears solely as
a documented field in `services/DraftService.js`'s interface contract, with no
data behind it. This needs a new column in the rankings files (and the
generator that produces them) before the view can be built.

### Stage 3 — Draft (current app)
**Goal:** Live draft board with pick tracking  
- Existing board + pick tracker
- Focus / Normal view toggle (Short-Term feature)
- Best available per position highlighter
- Real-time pick entry

### Stage 4 — UDFA
**Goal:** Manage undrafted free agent signings post-draft  
- List of players not drafted
- Mark UDFA signings
- Priority targets flagged by pre-draft scouting tags
- Roster spots remaining tracker

### Stage 5 — Cuts / Roster Construction
**Goal:** Build the 53-man roster  
- Full roster view (drafted + FA + UDFA + incumbents)
- Cut / keep / practice squad decisions per player
- Positional depth chart view
- Export final 53-man roster

---

## Architecture Notes (Mid-Term)

### Stage Navigation
- Top-level tab bar: `FA | Scouting | Draft | UDFA | Roster`
- Each stage is a separate route or top-level component
- Shared state: player database, roster, contracts

### Data Model Evolution
```
Player {
  id, name, position, rank, consensus_rank
  // Stage 1
  fa_status, contract_value, signed_team
  // Stage 2
  scout_tag, personal_rank, notes
  // Stage 3
  draft_pick, drafted_by_team
  // Stage 4
  udfa_signed_team
  // Stage 5
  roster_status  // '53-man' | 'practice' | 'cut'
}
```

### State Persistence
- Move from in-memory state to `localStorage` or IndexedDB
- Import/export JSON for season saves
- Optional: Supabase/Firebase backend for multi-device sync

---

## Long-Term: Collaborative Expert & Public Sync

### Overview
Enable content creators/experts to log in, host public draft boards/rosters, and sync draft execution in real-time. Unauthenticated users can view boards or play locally.

### Key Features
- **Expert Authentication**: Simple login for up to 10 designated experts/content creators. No complex role hierarchy—only two states: authenticated (expert) vs anonymous (viewer).
- **Public & Local Boards**:
  - **Authenticated (Experts)**: Can create persistent boards/rosters and "run" the live draft.
  - **Unauthenticated (Anonymous)**: Can see expert boards, click through draft simulation, and build their roster locally (stored in localStorage only), but cannot create public boards.
- **Real-Time Draft Sync (Follow Function)**:
  - One expert can "run" the draft live for all active viewers.
  - Viewers can opt to "follow" an expert's draft state, syncing their local view in real-time.
- ~~**Player Report Cards**~~ — ✅ **done, and considered sufficient.** The info
  card carries tags, total/position rank, the athletic-matrix numbers, and
  strengths/weaknesses/notes from every board at once. Editable in Scouting,
  read-only everywhere else (right-click or long-press a player). No further
  "grades and fit assessment" layer is planned.
- **Architecture/Backend**:
  - Requires a persistent database (e.g., Supabase, Firebase, or a light SQL backend).
  - WebSockets or lightweight subscription channels for real-time draft pick dispatching.

---

## Priority Order

_Updated 2026-09-03 against actual code, not just prior status — re-verify before trusting either._

1. ✅ Fix current board stability (no more sticky changes)
2. ✅ Normal vs Focus view toggle (Short-Term) — implemented in `CenterBoard.jsx` (`visiblePlayers = isFocusMode ? players : players.filter(p => !p.drafted)`, groups/rounds derived from the filtered set); confirm with a visual smoke-test
3. ✅ Clean up CenterBoard — no sentinel/shelf machinery found in current code; only ordinary CSS `position: sticky` headers remain
4. 🔲 **Fix Roster drag-and-drop on mobile/touch** — `RosterView.jsx` uses native HTML5 `draggable`/`dragstart`/`drop` only, no touch handlers, no dnd library in `package.json`; native HTML5 DnD doesn't fire on touch devices by design. Needs touch-event handling or a touch-aware library (e.g. `@dnd-kit/core`)
5. 🔲 Verify Ourlads auto-fetch position coverage (EDGE/specialists had repeated parsing gaps during development — regression-check before relying on it)
6. 🔲 Stage navigation shell (tabs, routing) — unify Draft/Roster into the full 5-stage tab bar; currently a flat 2-tab switcher in `App.jsx`
7. 🔲 Stage 2: Scouting view (builds on existing rankings data)
8. 🔲 Stage 1: FA tracker
9. 🔶 Stage 4: UDFA — folded into Roster's "Sign Player" flow (`UnrankedModal`'s `postdraft` mode) rather than a separate view; functionally covered, not a standalone UI
10. 🔶 Stage 5: Roster builder — substantially built and near-parity with Draft: drag-and-drop 53-man/practice-squad/IR/cuts, CSV import/export, Ourlads auto-fetch, position config. Remaining work is item 4 (mobile DnD) and general polish, not core functionality
11. 🔲 Mid-Term: Multi-season. Seasons are a **stack** — only the current one is
    writable, earlier ones are read-only, and you can scrap the current season to
    drop back to the previous one. Nothing ever edits a season a later one was
    derived from, because going back means the later one no longer exists.
    Per-player provenance already exists in `roster.csv` (`:FA`, `:UDFA`,
    `:24/1`), and `roster_2025_end.csv` is derived from it — that suffix is the
    seed of the model. Wants the same "state belongs to a scope" change as item
    13, so they're cheaper built together.
12. 🔲 Mid-Term: Scouting grouped list (see Stage 2 above) — blocked on adding a
    school/college column to the rankings data.
13. 🔲 Long-Term: Expert Authentication & Real-Time Follow Sync (Database backed)
