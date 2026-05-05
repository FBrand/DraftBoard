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
**Goal:** Track FA signings and budget impact  
- Available/signed/released FA player list
- Contract value tracking per player
- Position need chart updated as FAs are signed
- Board shows remaining holes after FA

### Stage 2 — Scouting
**Goal:** Rank and tag draft prospects before the draft  
- View/edit personal rankings per position
- Tag players: ✓ like, ✗ avoid, ? monitor
- Compare consensus vs personal rank (value gap)
- Mock draft simulation mode

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

## Priority Order

1. ✅ Fix current board stability (no more sticky changes)
2. 🔲 Normal vs Focus view toggle (Short-Term)
3. 🔲 Clean up CenterBoard — remove sentinel/collapse machinery
4. 🔲 Stage navigation shell (tabs, routing)
5. 🔲 Stage 2: Scouting view (builds on existing rankings data)
6. 🔲 Stage 1: FA tracker
7. 🔲 Stage 4: UDFA
8. 🔲 Stage 5: Roster builder
