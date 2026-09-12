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
- ✅ Everything is in `localStorage`, behind `src/data/repository.js`
- ✅ Import/export of a whole session as JSON (`utils/appSession.js`, versioned)
- 🔲 A real backend for multi-device sync — see below

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
- **Architecture/Backend**: Firestore. The storage layer was built against its
  interface from the start — see the migration below.

---

## Migrating to Firebase

_Written 2026-09-12 against the code as it stands. The point of `src/data/` was
always that this would be an adapter swap; most of it is, and this section is
honest about the part that is not._

### What is already in the shape

`src/data/repository.js` stores documents in named collections, addressed by
id, with `where` / `orderBy` / `limit` over them — Firestore's interface,
narrowed to what this app does. `localAdapter` is one implementation of it.
Five collections go through it today: `players`, `boards`, `seasons`,
`authors`, `evaluations`.

`repository.subscribe()` also already exists and is wired only to a local
notify. `onSnapshot` maps onto it almost directly. That is the cheap part, and
it is the part that turns "we cannot both edit the same board" into a yes.

### What is in the way

**1. Four stores are still single JSON blobs, not documents.**
`scouting_board_v1__<boardId>`, `rosterState`, `fa_state_v1` and
`nfl_draft_board_state` sit on raw `localStorage` keys, outside the
repository. The board entries are the one that matters: two analysts editing
different players on the same board are two whole-blob rewrites racing each
other — exactly the failure `localAdapter`'s own header comment says the
document shape exists to prevent. It wants to become
`boards/<id>/entries/<playerId>`, one document per player. Roster and Free
Agency are the same job (a document per slot); draft picks are already
naturally one document per pick.

**2. `loadSync` has to go, and its absence will be loud.**
The repository offers synchronous reads — `get`, `all`, `docs`, `query` —
which only a local adapter can serve, and roughly twenty call sites use them.
A Firestore adapter must not implement `loadSync`; that is deliberate, and it
means every one of those sites returns null or empty until `ready()` resolves.
This is the single biggest source of "it rendered blank once" on migration.
Each view needs to await the collections it reads and hold a real loading
state, not just the one draft-data gate in `App.jsx`.

**3. Authentication.**
A board carries an `authorId` pointing at a row in a collection, with no login
behind it. Rules cannot say "Ryan may write Ryan's board" until a board carries
a real uid. Anonymous auth is enough to start.

**4. Security rules.**
The board is going on a stream. Anything world-writable gets defaced.

**5. Writes become fallible.**
`set` currently cannot fail — the adapter swallows quota errors, and the
repository has already told the UI the write succeeded. Over a network that
needs retry, an offline queue, and something on screen when a save does not
land. Nothing surfaces that today.

**6. Seeding moves off the client.**
First load parses the CSVs in `public/` into storage per visitor. Remote, that
has to happen once behind a guard, or every new viewer re-seeds shared data.

**7. Session export/import changes meaning.**
It bundles raw `localStorage` keys today. It becomes read-collections /
write-under-this-user, and can no longer simply overwrite keys.

### Order

Auth → split the board entries into documents → remove the synchronous reads →
rules. Get two people editing one board working on the collection that needs
it, then bring roster, FA and draft across. Splitting board entries before auth
exists means doing the migration twice.

### Cost shape

~330 players × N boards. The batched write helpers that already exist
(`playerRegistry.setFactsMany`, `fillMany`, `repository.commit`) are what keep
a seed from being one write per player; that pattern has to hold, because
remotely it is one *billed* write per player.

---

## Priority Order

_Updated 2026-09-12 against the commit log and the code, not against the
previous version of this list. The 3 September version had seven items marked
unbuilt that had already shipped; if you are reading this after a long gap,
re-verify rather than trusting it._

**Done**

1. ✅ Board stability, Normal vs Focus view, CenterBoard cleanup
2. ✅ Roster drag-and-drop on touch — `@dnd-kit/core`, mouse and touch sensors
3. ✅ Five-stage navigation shell — FA / Scouting / Draft / UDFA / Roster
4. ✅ Stage 1 Free Agency, Stage 2 Scouting, Stage 4 UDFA (its own view, not a
   Roster flow), Stage 5 Roster
5. ✅ Roster sync from FA + draft picks + UDFA, additive so hand edits survive
6. ✅ Scouting as a grouped list — by position, school or round
7. ✅ Player facts vs board opinions vs per-author evaluations, with stable ids
8. ✅ Boards, authors and seasons as first-class records; consensus is the board
   with no author
9. ✅ Session export/import of every stage, versioned
10. ✅ Player report cards — considered sufficient, see above

**Open**

11. 🔲 **Test coverage regressed and has not been repaid.** The old browser
    suite (87 cases across `tests/*.spec.js`) was replaced by 96 Vitest unit
    tests plus a 17-case fast browser suite, on the understanding that the new
    ones would cover the same ground. Measured 2026-09-12, about half do.
    Biggest holes: **the whole mobile layout** (the fast config has one
    project, desktop at 1600×1000), **session export/import**, **roster slot
    geometry** (holes in a row, cutting a mid-row player, deleting a position
    row), **the FA/draft/UDFA → roster sync**, and the Add Players guard rails.
    The old specs still exist and still pass; nothing runs them.
12. 🔲 Take a player back off IR. Going on is a drag to the zone; there is no
    way off, so injuries only accumulate.
13. 🔲 Season rollover. Seasons are a **stack** — only the current one is
    writable, earlier ones read-only, scrapping the current one drops back to
    the previous. The data model is there and `boardRegistry.startSeason()`
    exists; nothing calls it, so there is no way to roll over or roll back.
14. 🔲 Firebase migration — see the section above.
15. 🔲 Expert authentication and real-time follow sync. Depends on 14.

**Dropped**

- Ourlads auto-fetch verification. The hardcoded fetch was replaced by a
  pluggable adapter interface (`1ab035a`); the depth chart is now seeded from
  a checked-in `roster_predraft.csv` transformed to this app's position
  labels. There is no auto-fetch left to regression-check.
