# Bugs and complaints

Everything reported, with what actually happened. Kept because things were
getting fixed and then quietly re-broken, and because "fixed" claimed without
a measurement has been wrong more than once here.

**Status means:**
`OPEN` — reported, not fixed.
`FIXED` — fixed *and* verified by measuring or looking at it, not by reasoning.
`CLAIMED` — I changed something and have not verified it. Treat as open.

---

## Found by auditing the new write queue, 2026-09-14

Three, all in code written the same day, all found by driving the thing rather
than reasoning about it.

| # | What | State |
|---|---|---|
| A4 | **A reload dropped 84 of 91 players** | The restored queue was applied to the cache, which made `cache.has(collection)` true — and `ready()` reads that as "already loaded" and skips the store. Two restored rows became the entire depth chart. **Fixed:** the queue is not seeded into the cache; it is merged on top when the collection actually loads. |
| A5 | **The unsaved change was then lost anyway** | The merge was on the asynchronous load only. The synchronous path — `ensureLoaded` via `loadSync`, which is the door the app actually comes through during render — filled the cache straight from the store, so a reload showed the OLD value while the queue quietly wrote the new one. **Fixed:** one merge, both doors. |
| A6 | Flaky test | The store-refuses test passed alone and failed under four workers. The fragile part was the drag, not the queue, so it now proves the drag landed before asserting anything about syncing — a drag that silently did not take was being reported as a sync bug. |

## The audit, 2026-09-14

What was walked, and what it found. Every stage at 1600, 1280, 900 and 390,
plus the flows a person actually performs.

**Three real bugs, all fixed** — A1, A2, A3 below. Plus the write-failure
rework, which was a design fault rather than a bug: a refused write threw the
change away.

**Clean, verified rather than assumed:**

| Flow | Result |
|---|---|
| Scouting: drag the ranking | moves, survives reload, no console errors |
| Draft: click while running / once over | drafts him / opens his card — both correct |
| Roster: cut a player | lands in cuts, survives reload |
| Free agency: add a candidate | 77 → 78, visible immediately |
| UDFA: sign somebody | leaves the board, appears in the signed panel |
| Session export → wipe → import | 13 keys, all 91 roster players back |
| Roster CSV out and in | identical, 91/91, IR and cuts preserved |
| Free agency CSV out and in | identical, 77/77 |
| Board CSV export | 409 rows, covers the whole board |
| Overlays (help, seasons, add players) | all close on Escape **and** on the backdrop |
| Evaluations | written, survive reload, do **not** leak to another analyst |
| Roster sync, run twice | idempotent, no duplicates |
| Archived season | refuses writes on every stage, banner says why |
| Console errors across all stages and sizes | none |

**Four of my own findings turned out to be the checker, not the app** — worth
recording, because each cost time: cards "clipped" by 8px are the tag marker
overhanging on purpose; the "off-screen panel" is a closed drawer; the missing
toast was `.app-toast` looked up as `.toast`; and the FA import "failure" was
my probe clicking "Import Positions from Roster".

## Found by the audit

| # | What | State |
|---|---|---|
| A1 | **Scouting's More menu unreachable at 1280px** | `.top-panel` was `nowrap` with `overflow-x: visible`; the bar wanted 1365px and had 1280, so the actions block sat from 1100 to 1365 and the menu was entirely past the right edge with nothing able to scroll to it. Settings, Add Players, Export and Restore were silently unreachable at one of the commonest laptop widths. The bar scrolls now, and its children keep their size rather than being squeezed unreadable. **Fixed** — menu reaches 1171–1248 and opens. |
| A2 | Search box had no accessible name | Only a placeholder, which vanishes the moment anybody types. A screen reader announced an unnamed edit box on both Scouting and Draft. **Fixed.** |
| A3 | A closed drawer kept keyboard focus | The draft's side panels are drawers at `translateX(-100%)`, and a transform takes nothing out of the tab order — Tab walked into a panel at x=-196, the page did not move, and the next keystroke went somewhere invisible. `visibility: hidden` while closed. **Fixed.** |
| — | *Not a bug:* cards "clipped" by 8px | The tag marker is `position: absolute; top: -8px; right: -8px`, overhanging the corner by design. My checker was measuring intended layout on every card on every screen; the checker was wrong, not the app. |
| — | *Closed, by design change:* the view not rolling back after a refused write | It no longer should. A refused write is kept and retried now, so the change staying on screen IS the intent, and the indicator says whether it has reached storage. The two facts — what you did, and whether it is saved — have two places to live. |
| — | *Closed, verified:* unhandled rejection on a failed write | Gone. The queue rework catches internally instead of re-throwing, so nothing reaches the console. Checked with a real quota failure: no page errors, no console errors. |
| — | *Not a bug:* off-screen panel at phone/tablet | Same drawers as A3, off-screen on purpose. Reported until the checker learned to ignore `visibility: hidden`. |

## Open

| # | Reported | State |
|---|---|---|
| 23 | **Storage runs out after a handful of scouted seasons** | Measured per unit: a registry record is **124B**, a board entry **56B**, an evaluation remark document **1042B**. The shipped example holds just **7 remark documents**, which is why measuring storage on it under-reports by an order of magnitude — and why an earlier "correction" of this row claimed 9.6KB a season and dozens of seasons of headroom. That number was a rolled-over season with no work done in it. With ~500 new players a season: registry +62KB, board entries +84KB across three boards, charts and picks ~20KB — about **166KB before anybody writes a word of scouting**. Remarks are per player per author, so 100 players seen by three analysts is +313KB and 300 players is +938KB. A genuinely scouted season is **0.5-1.1MB**, which is four to ten against a 5MB cap. The original 834KB estimate was right. Evaluations are the dominant cost and the thing to watch — which is also why pruning players matters more than dropping charts: `evictSeason` drops a pruned player's remarks with him, and that is where the space actually is. |
| 22 | Roster sync has the same what-he-plays / where-he-stands problem | `syncFromStages` places players with `resolvePosition(p.position)`, so an OT with only LT and RT rows counts as "no matching position row" instead of being placed. The add form solves this by asking; sync has nobody to ask, so it needs a different answer — probably leaving them unplaced and naming them, which is what it already does, but the message should say it is about the ROW rather than the position. Deferred by the user. |

## Fixed this round

| # | Reported | What it was |
|---|---|---|
| 24 | A rankings file that contradicts itself was resolved silently | `rankings_dan.csv` had Jakobe Thomas twice, at 3.4 and 5.3. The app showed him once and said nothing. Two dedupe rules eight lines apart in `useBoardRankings.js` pointed opposite ways: the shared pool (`unionOfFiles`) kept the FIRST row, the board's own placement map kept the LAST — so his identity came from one row and his tier from the other. FIXED: the placement map is first-wins, matching the pool and `writeEntries`; `duplicatesIn()` reports what a file rates twice and Scouting shows it above the board — "Dan rates Jakobe Thomas 2 times — 3.4 and 5.3. The first is used." The duplicate row is also out of the shipped file. |
| 1 | Mobile: FA only shows cuts | Depth chart and cut panel are flex siblings; stacked they still competed for a fixed height, so 11 cuts left the chart ~20px tall and it was painted over. Both size to content now. |
| 2 | Mobile: Draft "Unranked Player" broken | Same form as the sign modal — a 180px label beside a ~150px input. Label goes above the field below 640px. |
| 3 | Mobile: stationary "Your Picks" label eats space | 120px of a 390px bar spent on the heading. Now 66px. Stationary was right; big was not. |
| 4 | Mobile: UDFA side panel missing | `display: none` below 820px. It is the only place a signing appears, so the one stage about signings could show none. Stacks under the board now. |
| 6 | Mobile: roster position delete button not showing | `opacity: 0`, revealed on `:hover`. No hover on a touch screen, so invisible permanently. Shown at rest. |
| 7 | Roster panel lost horizontal scroll | **Mine.** `overflow: visible` on `.roster-main`, added while fixing #1, removed the scroll. Back to `overflow-x: auto`. |
| 8 | Roster/FA specialists cut off, not scrolling | Same cause as #7. Scroll restored. |
| 9 | Specialists box too narrow, draws through the kicker card | Sized to the container while the row it sits in scrolls to 1681px, so the cards ran straight through its border. `width: max-content; min-width: 100%` — it holds its contents and is never narrower than the column. Box now 719px, rightmost card ends at 694. |
| 10 | Picks bar heading beside the cards | Moved above them on a narrow screen. Beside, it takes width from the one row whose job is showing cards, and shrinking it only made a small label that still did. |
| 11 | Roster sign: Diego Pounds, LT, 2026 — wrong player picked up | **Real bug, found by the check you asked for.** Signing minted a SECOND registry record: Diego Pounds / LT / no school / no draft history, alongside the existing Diego Pounds / OT / Ole Miss / 2026 UDFA / BAL. The sign path resolved by name AND position, but the position typed there is a depth-chart alignment (LT) and his position is what he plays (OT) — so it matched nobody and created one. On screen it looked right the whole time, because the card resolves by name and found the original; the duplicate was only visible in storage. Resolves by name first now. Verified: one record, keeps OT / Ole Miss / 2026 / UDFA, team correctly BAL → KC. |
| 21 | Scouting: gap above the topmost group heading, names visible through it while scrolling | The heading is sticky at `top: 0`, which means the top of the scrollPORT — inside the container's padding, not above it. `.scroll-container` is defined **twice** in the stylesheet and the later rule sets `padding: 0.5rem`, so the list carried 8px of top padding: the heading parked 8px down and the band above it was covered by nothing. Top padding removed, sides kept (the column-width thresholds are measured against them). Verified: gap 0, nothing found in the band. |
| 18 | The Activate button should not exist | Removed. Injured reserve is a place, not a flag: dropping a player there puts him on it and dragging him out takes him off, and the button was a second way of saying what the drag already said. The one rule it carried survives as `clearInjuryArrival` — leaving IR drops an "IR" arrival, which was a status wearing an arrival's clothes, and keeps every real one. |
| 19 | Specialists should be normal clickable player cards | They were a hand-rolled copy of the slot that had drifted: no click handler, so punter, kicker and long snapper were the only three players whose card could not be opened. They use the ordinary cell now. |
| 20 | Specialist slots not droppable; golden border; card does not fit | All three from that change. An empty specialist rendered a "NEED" label instead of a cell, so the positions you are most likely to be filling had nowhere to drop a player — it always renders a cell now. The box was 175px wide with a gold border, holding a card that is itself 175px wide, so the card could not fit inside the frame drawn around it; the frame is gone and the card carries its own edge. Verified: drop in, drag out, both ways. |
| 17 | New season: roster prefilled, FA empty | Backwards. An offseason STARTS at free agency and ENDS at a 53-man roster, which is what the app's own files already say — `roster_2025_end.csv` gives the structure with an empty depth chart, `roster_predraft.csv` gives free agency its candidates. Last season's roster is now free agency's pool; the new roster keeps its shape — position rows and slot counts — and none of its players. Verified: new season has 0 on the roster across 22 rows, 91 in free agency. |
| 14 | Rollover changed nothing — pool, boards, roster all stayed | The season stack was records only. The roster, free agency, the draft and the prospect pool were single global keys, so every season shared one of each. They are season-scoped now, with the old unscoped save migrated into the season that was current when it was written. |
| 15 | Switched back to 2026, still editable | `isFrozen` was exported and had **zero** consumers — nothing enforced read-only. Guarded at each store's `saveState`, which is the one door every change goes through, rather than on each control where one forgotten button is all it takes. A banner says why, since a stage that silently refuses to change looks broken. |
| 16 | A new season re-read last year's files | Each stage decided for itself whether to seed, so a fresh season re-read the 2026 picks from `DraftBoard_Picks.csv` and fell back to the shipped rankings for a class that had not been drafted — 885 players who were already gone. One `initialiseSeason` decides now, once per season, and records that it ran. Verified on a fresh season: 0 players on the board, 0 picks made, no boards, FA unseeded, roster carried forward. |
| 12 | Pounds shows as R5 | `round` on a board player is where somebody PROJECTED him, not where he went. He was never drafted, and the roster slot printed the projection as history — among numbers that all otherwise mean something that happened. Reads **UDFA** now. |
| 13 | Pounds: no last team showing | Signing wrote his new team over his old one and kept nothing. He arrived from Baltimore and his card then showed no previous team at all. Signing now carries the team he is leaving into `previousTeam` — an explicitly typed one still wins. Verified: card shows **PREVIOUS TEAM BAL**. |
| 5 | UDFA sign modal still broken | The inputs were only half of it. UDFA offers three actions, each `flex: 1` and none able to shrink below its own text; on a 353px modal with 64px of padding they overflowed, and because the row is justified to the end the overflow went off the LEFT. The gold **Sign UDFA** — the primary action — was a sliver past the edge of the screen, so the form looked complete and could not be submitted. The actions stack on a narrow screen now. Verified: nothing overflows the modal. |

## Reverted

| Reported | What happened |
|---|---|
| Picks bar collapse | I made the bar collapsible on mobile, having misread the complaint. It was also broken — expanded, the picks row was pushed off at zero width, and I had verified only the collapsed state. Reverted entirely; the label size was the actual problem. |

## Questions asked and not answered

- "What is that Activate button supposed to be?" — see the answer given in chat; if the answer is that it should not exist in that form, it goes here as a bug.

## The deep audit, desktop and 390px — 2026-09-14

Walked all five stages at 390x844 and 1600x1000, driving real flows rather
than screenshotting: switch board, open a player, open the Seasons modal,
draft a card, count roster slots. Then looked at every screenshot.

**Found and fixed**

| # | What | State |
|---|---|---|
| 28 | **A rollover carried nothing: new roster prefilled, free agency empty** | The bug the user reported twice, still there. `seasonInit` read and wrote the STAGE store; the roster and free agency had moved to row documents in `depthChartStore` so one drag writes one row. So `readStage('rosterState', outgoing)` returned null, nothing was carried, an empty `positionConfig` was written — and because an empty config does not satisfy the roster's own fallback, the new season fell through to bootstrapping `roster.csv` and arrived with all 91 players of a season it had nothing to do with. One missing store, both symptoms. FIXED: `seasonInit` uses the same chart-first precedence the roster itself uses. Verified in a browser: roster 91 → 0, FA 0 → 91, rollback restores 91 and 328 rows. |
| 29 | **Rolling back threw a render error while succeeding** | `Cannot read properties of null (reading 'year')`. The confirm block names both seasons and outlives what it asks about: `scrapSeason()` succeeds, the season underneath becomes current, and React re-renders the open modal once more before the reload lands — at which point there is no season underneath, so `previous` is null and "…{previous.year} becomes current again" threw. The rollback itself was correct; only the sentence describing it failed. FIXED by not rendering the confirm block once there is nothing left to confirm. |
| 25 | **A finished draft announced a pick that cannot happen** | The counter runs one past the final selection, so the header read `NOW DRAFTING #258` on a draft that ends at 257 — in the biggest text on the screen, which is the line a broadcast puts on air. Every other part of the view had already switched over: a card click signs a UDFA, the board is in post-draft mode, the tracker says "none left". Only the headline disagreed. `DraftView` already computed `draftComplete` and never passed it to the header. FIXED: reads `DRAFT COMPLETE / UDFA`, and the OURS badge no longer appears for a pick nobody owns. Covered by `tests/fast/draftComplete.spec.js`. |

**Found, open, not fixed unprompted**

| # | What | State |
|---|---|---|
| 27 | The draft and UDFA boards are a 2160px canvas in a 390px window | Measured: `scrollWidth` is 2160 at every viewport. A phone shows 18% of the board and needs 5.5 screen-widths of horizontal scrolling to reach the last position column; a 1600px desktop shows 74%. Scouting solved exactly this by collapsing to a single column at narrow widths (`useScoutingLayout`); Draft and UDFA never got that treatment. Not touched because it is a redesign of the app's core view and nobody has complained about it — naming it rather than acting. |
| 26 | Tap targets under 28px on a phone | The slot steppers are 16x16 (`−` / `+` in FA and Roster), the row-delete `✕` is 22x25, and the board tabs are 18px tall. Guidance is 44px. Real, but a judgement call against a dense tool built for a broadcast — listed so it is a decision rather than an oversight. |

**Checked and NOT bugs** — recorded so they are not re-chased

- **A UDFA signed by another club shows as "available" on the draft board.**
  Deliberate, and documented where it is done: `CenterBoard` does
  `isTaken(player) ? player : { ...player, drafted: false }`, and `DraftView`
  passes `takenTest={isDraftPick}` — "drafted means drafted; a player signed
  as a UDFA went undrafted, so he stays available here". The card still prints
  "UDFA DAL", so who took him is on screen; only the dimming says available.
  80 of 217 board cards are in this state on the shipped season.

- **Touch drag-and-drop on the roster works.** Nothing in the suite covered
  it — every drag test drives a mouse, and dnd-kit runs a separate
  delay-activated TouchSensor — so it was worth proving. A finger moves a
  player exactly as a mouse does. Two "bugs" I reported against it first
  were my own synthesis: a stray tap before the press cancels the hold, and
  a target coordinate taken before the drag starts points at the wrong slot
  once the board auto-scrolls. Now covered inside the existing phone test,
  so it costs no extra boot.
- **Archived seasons are exactly right.** The banner explains itself, tag
  buttons and reorder handles are gone because a placement is history, and
  the pencil reveals 3 evaluation adders and 12 inputs with zero placement
  inputs — so "evaluations can still be added" is a promise the panel keeps.
- **A refused write is visible and explained**, and the edit survives it.
  Now covered by `tests/fast/writeRefused.spec.js`.
- **Session export, Start Clean Slate and Load Current State all behave.**
  Export is 801KB of versioned JSON, clean slate confirms first and empties
  the roster, and Load Current State brings back all 91 slots.

- Long names cut off in the side panels and depth-chart slots
  ("John Michael Gyllenborg" loses 29px): `text-overflow: ellipsis`,
  deliberate and graceful, not a hard clip.
- The top panel and tab bar cut off at 390px: both `overflow-x: auto`
  and genuinely scrollable — after scrolling, the Manage menu is fully on
  screen and opens all five items. Reachable, if without an affordance.
- A draft card "blocked" by an overlay: it is the bottom panel, which
  cards correctly scroll underneath.
- No horizontal page overflow, no console or page errors, and no control
  without an accessible name, at either width, on any of the five stages.

**The tests were part of the bug.** `seasonInit.test.js` had fifteen passing
tests over a rollover that did not work, because it used `writeStage` to set
last season's roster up and `readStage` to check the result — self-consistent,
and touching neither store the app reads. Both sides now use the depth-chart
store, and `tests/fast/seasonRollover.spec.js` drives the real flow, which is
the only thing that can catch the wiring being wrong.

**On the method.** Four of my six automated findings were false positives —
my checkers, not the app. The ones that held up came from looking at a
screenshot and from driving a flow. That matches what the user said:
sweeps find almost nothing; using the app finds the bugs.

## "Do we even need a dedicated picks store?" — measured

Answer: yes, and not for the reason I first gave. The reason I gave was
UDFA ordering; the user corrected that — there is no order to UDFAs, and
the numbers the app assigns them (258, 259 …) are `isUndraftedSigning`'s
flag wearing a number's clothes. That objection is void and the numbers
should go.

The real reason is that the two stores hold different things.

Measured on a cold boot, before anybody makes a pick:

| | count |
|---|---|
| registry records | 716 |
| …with `draftYear` 2026 | 641 |
| …with a `draftPick` | **295** |
| pick documents | **631** |

The pool knows the real 2026 draft, because `player_facts_2026.csv` seeds
it on every load and covers 295 of 638 selections. The picks store knows
what THIS session's draft did, which starts as the real one and stops
being it the moment anybody mocks. Deriving picks from the pool would:

1. lose the 336 selections the facts file has no row for, and
2. make "clear the draft" impossible — emptying the picks would leave the
   facts standing, so the real draft would reappear as this session's.

A mock draft has to be able to disagree with reality and to be thrown
away. That is what a separate store buys, and it is the app's whole job.

What DOES follow from the question, and is worth doing:

- drop the fake UDFA pick numbers; `isUdfa` already says it
- the draft should WRITE facts for players it picks, so the pool learns
  what the session did rather than only what the file said

## The Firebase audit, 2026-09-15

Eight bugs. Every one of them invisible against localStorage, because
localStorage answers synchronously and a remote store does not — so each was a
piece of code reading state before it had arrived, and getting a confident wrong
answer instead of waiting. Found by driving the app against the Firestore and
auth emulators with a real season seeded from a real local build, as a viewer
and then as an expert.

| # | What | State |
|---|---|---|
| B1 | **An expert's board never reached a viewer** | `openBoardEntries()` was `return Promise.resolve()` — "entries load on demand at their own path", true of a store that answers synchronously and false of every other kind. `hasEntries()` then read an unloaded collection, got "no entries", and seeded the shipped CSV over the board that was already there. The local overlay wins over the shared store, so the viewer kept that copy: Firestore said round 1, his screen said round 6, for good. **Fixed:** it loads the boards it is given. **Verified:** move a player to round 1 in Firestore, the viewer's screen shows him at row 1; a viewer now writes no copy of any board at all. |
| B2 | **One early write hid a whole collection** | A write has to prime the cache — `applyLocal` and `commit` both do, or a change would not show until the network agreed — and `ready()` read a primed cache as a loaded collection, so one document written before the load became the whole collection and the store was never asked. `restoreQueue` documents this exact trap (A4) and guards it by hand. **Fixed:** a `loaded` set only a completed `adapter.load` adds to. **Verified:** regression test fails without it. |
| B3 | **Free agency filed under a season that does not exist** | `faState.ensureSeeded()` read the season id at mount, before any season had arrived, and wrote to `seasons/_/charts` — invisible to the tab and to Roster's sync, and memoised under `_` so the real season never got a turn. **Fixed:** it waits for the seasons. **Verified:** no `seasons/_` key after boot. |
| B4 | **An unreachable database looked like a first run** | A shared store that could not be READ answers with an empty collection, deliberately, so a viewer sees his own work rather than a blank page. `openBoards()` read that as "nobody has ever made a board" and seeded a private season over boards that were merely unreachable — then kept it, because local wins. Measured 6 boots out of 6 against a build missing half its Firebase config. **Fixed:** failed reads are distinguishable (`repository.loadFailed`), are not cached as loaded so the next load retries, and seeding declines on an answer it cannot trust. **Verified:** 0 of 3 boots seed, and the app comes up empty instead. |
| B5 | **Nothing could ever be written to the shared database** | `auth.js` was complete and called from nowhere. No anonymous sign-in, so `isExpert()` was permanently false, so `writesRemote` was permanently false — for experts too. The end-to-end run's "Firestore was never asked for a write the rules would refuse" had been passing for that reason. **Fixed:** `main.jsx` starts a session, for a Firebase build only. **Verified:** `accounts:signUp` succeeds and the session is in IndexedDB. |
| B6 | **An expert was demoted to a viewer on every page load** | `startAuth()` read `auth.currentUser` to decide whether anybody was signed in, but that is null for a moment after `getAuth()` whether or not anyone is — the session lives in IndexedDB and is restored asynchronously. So it said "nobody", and the anonymous sign-in below REPLACED the expert's session. He signed in, reloaded, and silently became a viewer: his own board read-only, his writes going to localStorage. **Fixed:** it waits for the first auth state. **Verified:** a restored expert session survives and his writes route remotely. |
| B7 | **Wiring auth would have made every board read-only** | `editRefusal()` asked `isSignedIn()`, which an anonymous viewer answers yes to. Every board carries an `ownerId`, so the moment viewers got sessions, "is this mine?" answered no for every board a viewer opened — including his own play-along. Caught before it shipped, by asking what turning B5 on would do. **Fixed:** it asks `isExpert()`, the distinction `auth.js`'s own header warns about. **Verified:** a signed-in viewer can still tag a player. |
| B8 | **Placement documents carried evaluation data, spelled out in full** | `entryFields.lean()` passes a key it does not recognise straight through under its LONG name, and `saveEntry` spreads the whole display shape over the stored one — so an edit wrote `strengths`, `weaknesses` and `notes` onto a board entry, as empty arrays, on the largest collection in the app. Remarks moved to `evaluations/{player}/remarks` precisely so they would stop riding along on boards, and short field names are most of why this collection fell by 76%. The same write lost the entry's tag. `athleticMatrixTotal`/`athleticMatrixPosition` were also missing from the map, and would have leaked the first time a board overrode one. **Fixed:** the document carries the fields an entry declares and nothing else — a whitelist, because a blacklist fixes today's leak and leaves the next one for production. **Verified:** every field name on the shared board is one character, and the expert's tag lands. |

| B9 | **The player registry was rewritten 83 times at boot** | Importing a roster resolves one player per slot, and each resolve that created somebody committed the WHOLE collection: 83 rewrites of an 89KB key, 0.55 MB of localStorage writes, for a 91-player roster. `resolveAll` commits once for a list and the parser cannot use it — it needs an id back while it is still parsing the line. **Fixed:** the lookups stay one at a time, the writes batch, and a player minted mid-batch stays visible to the next lookup so the import cannot mint him twice. **Measured:** 83 rewrites -> 7, and 179 localStorage writes at boot -> 103 (0.66 MB -> 0.46 MB). It does NOT move the startup freeze — `setItem` was only ~90ms of that 7.2s, which is the separate C3 story. |
| B10 | **The markers that stop a season being set up twice were unreadable** | `seasons/{id}/setup` holds `season` and `facts`, and both exist so that whoever gets there first does the work and every other client reads the marker and does nothing — which is the entire reason they live in the STORE rather than in one browser. Both are read synchronously, and `openSetup()` returned a resolved promise without loading the collection. So against Firestore they read nothing, and NOTHING READS AS NOT DONE YET: the season is set up again, and the shipped facts are laid back over a draft somebody deliberately cleared — "null out a player's pick, reload, and the file puts it straight back". The same mistake as B1, with the same stated reason ("loads on demand"), true of localStorage and of no other store. **Found by sweeping for exports nobody imports** — `isInitialised` is called from nowhere outside its own file. **Fixed:** `openSetup(seasonId)` loads the markers; the draft hook now waits for `openBoards` first, because the season has to be known before its markers can be addressed. **Verified:** five tests against an adapter with no `loadSync`, which is the Firestore condition. |
| B11 | **The roster and free agency seeded over the shared ones** | Third instance of B1's shape, found by sweeping for every `open*()` that returns a resolved promise. `openDepthCharts` loaded nothing, so `hasChart()` answered NO for a roster sitting in Firestore and the stage seeded itself from the shipped file. **The end-to-end run had been calling this green from a COUNT** — 91 slots either way, because the app ships a file that produces 91 — which is the same false green already caught for the boards and still standing for the roster. Two more layers underneath: RosterView asked for the chart of season `null`, because `viewedSeason()` reads the repository and the seasons have not arrived when it mounts; and both stages decided "nothing saved here" from a synchronous read before the store had been asked. **Fixed:** charts are loaded for the season, the season is awaited first, and each stage re-reads before seeding. **Verified by changing a name in Firestore** and watching it reach the screen — with no chart document written locally at all. |
| B12 | **A viewer read the shipped example instead of the expert's evaluations** | Fourth instance, and the one that mattered most — evaluations are what outlives everything else, because the card reads across boards and seasons. `openEvaluations()` was an empty async function and `remarksFor` reads synchronously, so a player an analyst had written about came back with nothing; the shipped worked example then seeded ITSELF into the same paths, where the local overlay wins. Measured: opening ONE card wrote seven evaluation collections without anybody typing, each shadowing the expert's. **Fixed:** `openEvaluations(playerIds)` takes ids, because a remark collection is per player and there are seven hundred; the example asks for the seven paths it would write before deciding they are empty; the card asks for the selected player and bumps the tick it already keeps for this. **Verified:** the expert's remark is on the card and opening it writes nothing. |
| B13 | **A player added in the app reached nobody else** | The fifth and last of the shape. `openStages` loaded nothing, and what lives there is `prospects_v1` — the players an analyst adds himself, for somebody who declared late or was missed by every rankings file. The shipped season has none, which is why this one could not be measured from the seed and was written down as "assume the same fault". Writing one straight into Firestore settled it: 328 rows and no such player. **Fixed:** the opener loads the collection, and `prospects.write` refuses a season-less write like the charts do. Now 329 rows and he is there. Seven unit tests failed on that guard and were right to — they exercised prospects with NO season and passed only because the code silently filed them under `seasons/_/stages`. |

**Not bugs, checked rather than assumed:** tagging a player on the local build
shows, stores and survives a reload; the 37-test browser suite is unaffected by
all of the above.

**Two things I reported wrongly during the run, corrected here:** "the board came
out of Firestore" was read off a row count, and the CSV produces the same count
— the board was in fact local, which is B1. And a "6/6 seeding race" was my own
build missing half its config, not an app bug; chasing it is what exposed B4,
which is real.

### The pattern behind B1, B10, B11 and B12

Four bugs, one sentence. Each was an `open*()` that returned a resolved promise
and loaded nothing, and each carried a comment saying the collection "loads on
demand at its own path". That is true of localStorage, where `loadSync` fills a
collection the instant anything asks, and false of every other store — so every
one of them read as EMPTY against Firestore, and the app then seeded its shipped
data over the shared data, locally, where the overlay makes it win.

| opener | what was shadowed |
|---|---|
| `openBoardEntries` (B1) | the expert's board — 328 CSV entries over 150 real ones |
| `openSetup` (B10) | the markers that stop a season being set up twice |
| `openDepthCharts` (B11) | the roster and free agency |
| `openEvaluations` (B12) | every remark anybody had written |

| `openStages` (B13) | the players an analyst added himself |

That is all five. `openDraft` and `openRegistry` were the same shape and are
not bugs: both actually load. Every opener in the app has now been checked by
changing its data in Firestore and looking at the screen.

What made them findable was not reading the code — all four had been read many
times — but asking one question of the running app: CHANGE SOMETHING IN
FIRESTORE AND SEE WHETHER THE SCREEN NOTICES. Row counts cannot answer it,
because the app ships a file that produces the same counts.

### The write side, checked the same way

The opener sweep was about READS. The mirror question is whether an expert's
changes reach the shared store at all — a stage that reads correctly and writes
only to this browser looks perfect to the person making the change and is
invisible to everyone else. Four paths driven as a signed-in expert, each one
confirmed in Firestore rather than on screen:

| what he changed | result |
|---|---|
| a tag on a board entry | reaches Firestore, nothing kept locally |
| a position row's 53-man count | reaches Firestore, nothing kept locally |
| a player added with + Add Players | reaches Firestore; not filed under `seasons/_` |
| a remark on a player card | reaches Firestore, nothing kept locally |

The write side was already right. Worth knowing precisely, given how wrong the
read side turned out to be — and it also proves the season guards added with
B11 and B13 do not misfire, which would have made those edits do nothing at all.

### Still open: an expert's change made during a connection drop is lost, silently

The broadcast failure that matters. An expert is on air, the connection goes,
he tags a player. Driven with the page cut off from Firestore and then
reconnected:

| | observed |
|---|---|
| he can keep working | yes — the board is intact and the tag shows |
| he is told | yes, while it is down: `Saving…` |
| the write reaches the store while cut | no, correctly |
| after reconnecting, within 130s | **never arrives** |
| the indicator after reconnecting | **nothing — "saved"** |
| `pending_writes_v1`, the retry queue | **absent** |
| after a reload | **still gone** |

So the change is lost, and the app says everything is fine. That is precisely
the failure the sync indicator and the persisted queue exist to prevent — "a
failed save must be visible, not silent" — and neither engaged.

**Why the safety net did not catch it.** `repository.attempt()` enqueues on
CATCH. The queue, the retry and the warning all hang off the adapter's promise
REJECTING. Here it did not reject — the indicator went from `Saving…` to
nothing, which is `inFlight` falling back to zero — so as far as the repository
was concerned the write succeeded. A write that neither lands nor fails is a
case the design does not have.

**The caveat is discharged, 2026-09-16.** It was induced by aborting the page's
requests, and the SDK treats "every request fails instantly" differently from
"the network is gone". Re-run with `context.setOffline(true)` — a real drop,
same expert sign-in — and **it reproduces exactly**:

| | with a genuine offline toggle |
|---|---|
| he can keep working | yes, and the indicator says `Saving…` |
| `pending_writes_v1` DURING the outage | **present** — the write IS written down now |
| after reconnecting, within 130s | **never arrives** |
| the indicator after reconnecting | **nothing — "saved"** |
| the queue after reconnecting | **absent — released** |
| after a reload | **still gone** |

So the app-side net now engages, and is then discarded: Firestore resolves the
promise without the write landing, the repository correctly releases a write it
has been told succeeded, and the queue entry goes with it. A store that lies
about success defeats everything above it.

This is the whole of what remains, and it is a seam decision — what counts as
"failed" when a promise resolves and nothing arrives.

### The mechanism, traced 2026-09-16

It is not `setDoc`. A board entry is written by `writeEntries`, which diffs and
commits a BATCH, so the call is `writeBatch().commit()` — which is why a trace
on `setDoc` showed nothing and sent me looking for a missing expert instead.

With both adapters traced, an outage reads:

```
connection cut
overlay.commit boards/…/entries x1 -> REMOTE
batch issued boards/…/entries x1
connection restored
batch RESOLVED boards/…/entries x1 after 10059ms
the change is gone
```

**The batch resolves, ten seconds after the connection returns, and the write
is not in the store.** The repository then does the only thing it can with a
success: it releases the queue entry.

That also settles the research that seemed to contradict this. The SDK's
documented behaviour — a write promise does not resolve until the server
acknowledges — is written about `setDoc`. A batch commit is a different call
and does not behave the same way here.

**The probe now refuses to conclude without an edit**, and asks the WRITE QUEUE
rather than the screen — the DOM tag markers reported "no edit" on a run where
the adapter had plainly issued a batch, so that guard produced false aborts of
its own.

### Firestore's own state, watched through the outage

| | entry documents | carrying a tag |
|---|---|---|
| before the outage | 150 | 8 |
| while cut | 150 | 8 |
| 20s after reconnecting, batch RESOLVED at 10019ms | **150** | **8** |

Not a new document, not an updated tag. The batch resolved and the store did
not change.

### Which contradicts the documentation, so read this before acting on it

A batch commit is documented to resolve **only** once the writes are in the
backend, and batches are documented to persist offline. The complaint everybody
else has is the OPPOSITE of this one: that a commit **hangs** offline and never
resolves (firebase-js-sdk #6515, #2822, firebase-ios-sdk #478). A false resolve
is not a reported failure mode anywhere found.

**Every measurement here is against the emulator.** `firebase-tools`' Firestore
emulator does not promise to reproduce production offline-sync semantics, and
when a measurement contradicts behaviour thousands of applications depend on,
the emulator diverging is far likelier than Firestore losing acknowledged
writes. **This should be reproduced against a real project before it is called
a Firestore bug** — which needs credentials.

What holds either way: the app must not treat the resolve as proof. The
established mechanism for "has this reached the server" is
`waitForPendingWrites()` (firebase-js-sdk #3661), or `metadata.hasPendingWrites`
per document — never the write promise. That is the shape of the fix whichever
way the emulator question lands.

Worth fixing at the seam rather than in the app: the adapter should decide when
a write has failed — a timeout, or Firestore's own connection state — rather
than waiting for a promise that may never settle either way.

**Re-measured 2026-09-15, after the write-queue change on lantern.** Half of
this moved and the other half did not, and the difference is worth stating
precisely:

| | before | now |
|---|---|---|
| `pending_writes_v1` DURING the outage | absent | **present** — `boards/b_consensus/entries`, `fernando mendoza\|QB` |
| after reconnecting | absent, change lost | absent, change lost |

The repository now writes an unacknowledged write down while it is
unacknowledged, so the reload somebody does mid-outage no longer throws it
away. That is a real improvement, and it is not the bug on this line.

What still loses the change is the **false acknowledgement**: Firestore
eventually RESOLVES the promise without the write ever reaching the store, the
repository correctly releases a write it has been told succeeded, and the queue
entry goes with it. Nothing above the adapter can tell that apart from a
success — which is exactly why this wants deciding at the seam rather than
patching further up.

### Still open: the draft board does not follow the store

ROADMAP calls this the point of the whole phase — "when an expert drafts a
player, all followers' boards update instantly". Measured with two pages open
at once, the viewer's never touched after loading:

> The expert drafts. **The pick reaches Firestore.** The viewer's open draft
> board never notices — 217 cards before and after, for 25 seconds.

`repository.follow` exists, works and is tested — it is wired in `ScoutingView`,
where an expert's move reaches an open page in about a second. The draft board
is a different view reading a different collection and was never wired, so the
half that is finished is the scouting board and the half the ROADMAP names is
not. That asymmetry was introduced by doing the first half.

It is not a line of wiring. The draft state is reconciled against the parsed
player pool inside `loadInitialData` — joining saved picks to players by id and
then by name, twice, in both directions — and that path costs ~1.5s on a
desktop and several seconds on a throttled phone. Re-running it per pick is the
wrong shape for a live draft, so following it properly means lifting the
reconciliation out of the app's most complex hook into something that can take
(pool, savedState) and hand back the three pieces of state it sets.

Worth doing deliberately. Written down rather than attempted mid-audit.

### Open

| What | Why it matters |
|---|---|
| **No sign-in UI at all** — `signInExpert()` has no caller | An expert cannot sign in from the app. The write path is verified by restoring a session the way Firebase does, so the button has somewhere to land, but nobody can press it yet. |
| **The viewer's board takes 9-20s to populate** against a LOCAL emulator | A real network is slower. Nothing shows a loading state meanwhile. |
| **GitHub Actions config injection** | The deployed build has no Firebase config yet. |

## Flows walked on 2026-09-15, hunting rather than confirming

Driven through a browser against the built app, looking for the failure each
one invites. All three hold. Written down because each was a real suspicion
with a plausible mechanism, and "we checked" is worth more than silence.

| flow | the failure it invites | result |
|---|---|---|
| Rename a player, then reload | The rankings file still carries the OLD name, so the next load resolves it to nobody and mints a SECOND record — the duplicate-player bug, arriving through the one door that looks like an edit. | Holds. 740 records before and after; one record carries the new name; he is still on the board. The alias does its job. |
| Start Clean Slate | The wipe list and the storage keys are two places that can disagree, and the rewrite renamed every collection key. | Holds. The wipe matches on the `db_` prefix, so it cannot go stale that way. A new season is minted, the user's own work is discarded, and the app comes back usable. The player POOL stays, which is correct — the rankings files are data, not work. |
| Two tabs (below) | The second tab writes its stale copy over the first tab's work. | Holds, for two independent reasons. |
| Export the full session, clean slate, import it back | The bundle is built from a key list, and the rewrite renamed every collection key — a stale list exports an incomplete season and the import succeeds anyway, silently short. | Holds. `appSession` enumerates through the same `db_` prefix as the wipe, so it cannot drift. Measured: 186 KB, `version: 1`, 18 collections; the tag made before the export is back after it, and the board returns with all 328 rows. |
| Roll over, then open the archived season | One rule in `permissions.js` carries an exception pulling both ways: a finished board must not move, but what you learn about a player keeps arriving after it. That is the kind of exception somebody tidying a boolean removes. | Holds, precisely. The archived board offers no live tag control at all, and the pencil unlocks three evaluation controls WITHOUT unlocking any placement control. The banner says the season is finished. |
| Bring a player back off injured reserve | A deferred request said IR was one-way: a drag puts a man on it and nothing takes him off as healthy. `performMove` looks like it supports the return trip — it clears the injury arrival, because "leaving injured reserve is being activated" — but nothing tested it. The existing IR test drags to CUTS, which empties the slot while RELEASING the player, so it passes whether or not a man can actually come back. | Holds. Dragging from IR to an empty 53 slot takes him off IR and puts him on the roster. Now covered by a test that asserts both halves, because the old one could not. The request is closed. |
| Sign an undrafted free agent | A whole stage with no coverage, and an earlier probe had left it looking broken — clicking a card removed nobody and opened nothing. | Holds. The probe was double-clicking, which opens the dialog and then dismisses it. A single click opens a sign flow offering SIGN UDFA, SIGN · NO TEAM and MINICAMP INVITE, and signing takes him off the board (9 cards -> 8). |
| Add a free-agency candidate | The least-driven stage, and two recent changes run through it: the `computePositionNeed` NaN fix and the chart loading B11 rebuilt. | Holds. 77 candidates seeded across 22 rows, no NaN on screen, and the roster untouched — which is the whole design of this stage, measuring needs against a chart it never writes to. Adding a candidate with a position no depth-chart row is called is REFUSED, with the reason on screen: *"Nothing on the depth chart is called \"WR\". Pick where he lines up."* Choosing where he lines up adds him, and he survives a reload. |
| Try to delete a player three analysts have ranked | A delete once took the player out from under every board, remarks and placements included, with nothing to undo it — which is why `playerWork.js` exists. The predicate it offers, `isUntouched`, is exported and called from nowhere, which is what made this worth checking. | Holds, and precisely. A ranked player is offered no Remove at all, only "clear THIS board's opinions", and the card names the boards holding work on him — "Ranked or evaluated on Consensus, Dan, Ryan — clear those first". Clearing one narrows the list to "Dan, Ryan" and he stays protected. `isUntouched` is redundant API surface rather than a missing wire; `whoHasWorkedOn` does the job. Now covered by a test, because the failure is silent and unrecoverable. |

**One piece of friction, not a bug.** Rolling over needs a year typed in —
`disabled={busy || !year}` — while the field shows the obvious answer as a
greyed placeholder. So the screen reads "ROLL OVER, 2027" with the button
dead, and it is not obvious the number has to be retyped. Defaulting the field
to `current.year + 1` would cost nothing; left alone because the confirmation
text below it is doing deliberate work and this is the user's call, not mine.

**The count is now five.** Free agency added two more probe faults to the
three already recorded: clicking `.last()` button matching /Add/ hits "ADD AS
TRADE TARGET" rather than "ADD AS FA TARGET", and reading only the first 90
characters of a dialog misses the error message at the bottom of it. Both
read as "the add silently does nothing"; the app was explaining itself the
whole time.

**A note on method.** Three of the "bugs" this round were faults in the probe,
not the app: reading only the first of three board collections, counting
seeded `like` tags as if they were the user's work, and comparing localStorage
key NAMES when the reload recreates those keys immediately. Each looked like a
real finding until it was checked. A probe is code, and it is wrong as often
as anything else is.

## The app open in two tabs — checked, and it holds

Not exotic: a tab left over from earlier, or the analyst opening the board
again mid-draft. Both tabs share one localStorage and each keeps its own
in-memory copy of every collection, so the obvious failure is the second tab
writing its stale copy over the first tab's work.

Driven rather than reasoned about — two tabs, an edit in each, then a reload:

| flow | result |
|---|---|
| tag a different player in each tab | both tags in storage, both survive the reload |
| bump a different position row's 53-man count in each tab | both survive |

It holds because of two things, and removing either would lose work silently:

1. **Writes diff.** `docSet.write` and `writeEntries` work out which documents
   actually changed and commit only those, so a stale tab has no opinion about
   rows it did not touch — even though it rebuilds the whole chart in memory.
2. **The commit re-reads.** `localAdapter.commit` reads the stored collection
   back before applying the changed documents, rather than serialising the
   tab's cache. One key per collection makes the whole value the unit of
   write, so without this step every commit would publish a stale snapshot of
   everything else in that collection.

What does NOT happen is live update between tabs: tab A keeps showing its own
copy until it is reloaded. That is expected for a local-only app, and is the
thing the shared backend on the `firebase` branch changes.

## A guard that had stopped guarding, 2026-09-15

| # | What | State |
|---|---|---|
| C5 | **"Written by a newer app — don't guess" could never fire** | `rosterState.migrate` and `faState.migrate` both refuse a chart from a newer build rather than render it wrong, and the header above `STATE_VERSION` says why: without a version "there was no way to tell an old shape from a current one, so a stale blob was simply trusted and rendered wrong". That protection stopped working when the chart stopped being a blob and became row documents — nothing wrote a version any more, and neither caller can spread one in from a read that does not carry it. Two files described a guard that was unreachable. **Fixed:** the chart records the shape it was written in, and a chart written before that reads as current, which is what it is. **Verified:** two of the four new tests fail against the old code. |
| C6 | **And the guard firing would have lost the work** | With the version restored, a newer chart is refused — and free agency answers a refused read with `?? defaultState()`, so the stage comes up EMPTY. Save anything after that and the empty stage is written over the chart that could not be read. "Don't guess" turning into "delete" is the worst version of this. **Fixed:** both stages refuse to write over a chart whose stored version is newer than theirs, at the single door every change already goes through. **Verified:** a chart stamped v99 is refused by `loadState`, an empty save is ignored, and the player who was in it is still there. |
| C7 | **Restoring a session with any UDFA in it came back unsorted** | `deserializeDraftState` ends with `sort((a, b) => a.pickNumber - b.pickNumber)`, and a pick number is not always a number — this format records an undrafted signing as the literal `UDFA`, which is why the value is kept as a string when it will not parse. That subtraction is NaN, and a comparator returning NaN does not throw: it quietly sorts nothing. A session holding one UDFA came back in FILE order — measured as picks 3, 1, 2. The same trap as the `Math.max(257, "UDFA")` bug that once reported a finished draft as never started, in a file that had no tests at all. **Fixed:** sorted through `draftPhase.pickNumberOf`, which is where this rule is supposed to live — signings sort after every pick and keep their own order, the sort being stable. **Verified:** the ordering test fails against the old line. |
| C8 | **Unranked would have sorted to the TOP of the draft board's Remaining list** | Latent, and found by sweeping for the same trap as C7 rather than by hitting it. `LeftPanel` sorts the Remaining list with `a.overallRank - b.overallRank`, and an unranked player has no rank at all — `rankBoard` returns null rather than the worst number, deliberately, because numbering him last would assert a judgement nobody made. `null - 5` is -5, so he would sit above the best prospect in the class, in the list an analyst scans on air. **Not reachable on the shipped data:** all three boards were checked and the draft pool holds zero unranked players (217, 152, 87 cards, no UR row). It becomes reachable the moment a player is added in-app, since one arrives with `group: null`. **Fixed** to the same expression the rest of the app uses for this, `?? Number.MAX_SAFE_INTEGER`. Two `b.year - a.year` season sorts were guarded the same way, one of which sat next to an already-guarded copy of itself. |
| C9 | **A board created in the app showed another board's rankings** | Found by adding a board, which is how a fourth analyst joins. The dialog promises "Empty board — every player starts unranked"; it opened with 313 ranked players and the consensus board's placements, and survived a reload, so nothing about it looked stale. Two causes, both needed fixing. `pools` returned the FILE's emptiness for a board with no rankings file, and the consumer reads `pools?.[activeBoard] ?? players` — so "this board has no pool" fell through to the DEFAULT pool. And `loadFiles` reads `listBoards()` once and caches the promise for the life of the page, so a board created afterwards was in neither `files` nor `pools`; `invalidatePools` re-merges players but never re-reads the board list. **Fixed:** a fileless board is the same case with an empty file — every player, all unranked — and `invalidateBoards()` forgets the board list too, kept separate from `invalidatePools` because that one runs on every player edit and should not re-read three CSVs. **Verified:** 328 rows, all `???`, immediately after creating and after a reload; the other three boards keep their 328 entries and no new player records are minted. |

Neither is reachable today — `STATE_VERSION` is 1 and has never been bumped.
They are the kind of thing that is only ever found before it matters or long
after: the whole point of a version hook is to be correct on the day somebody
raises it, and this one would have been silently inert.

## Fixed the silence: starting a board from a CSV now says what it did

Given a file naming three players — two the class knows, one nobody has heard
of — the board gets three entries and the third is **stored and never
rendered**: the pool is built from the shipped rankings files plus in-app
prospects, the uploaded file is not kept, and an entry whose player is not in
the pool has nothing to attach to.

The banner now reads:

> Imported **2** players · **1** not on any board, so not shown

**What was fixed is the silence, not the behaviour**, and the distinction is
the point. Registering strangers straight from a CSV would walk around the
verification step Add Players deliberately insists on — "an import is a
proposal, not a bulk write" — so whether to do that is still a decision, and
still open. Telling the analyst what happened never was.

The cure had been sitting in the file the whole time: `ScoutingView` held an
`importSummary` state, rendered a banner for it, and carried the comment *"An
import that replaces a board should say what it did — silence here reads as
'nothing happened' when the file was wrong."* `setImportSummary` was never
called with a value anywhere in the codebase, so the banner could not appear.
Half-built, three hundred lines above the code that needed it.

Pinned by `tests/fast/importSummary.spec.js`.

### Closed, 2026-09-16: the strangers are now proposed, not dropped

The open half of this — whether an import should REGISTER the players no board
knows — turned out to be a false choice, and the user agreed with the third
option: neither.

Dropping them loses the analyst's work. Registering them straight from a file
walks around the one check that stops a man becoming two registry records —
which is exactly how the twelve duplicates got there. So the import now hands
those rows to **Add Players**, pre-filled, where each name is matched against
everybody already known and the commit stays disabled until every match is
resolved. Nothing is written until somebody says so.

`AddProspectsModal` takes an `initialRows` prop; `handleCreateBoard` collects
the rows its file named that the pool does not have and opens it with them. The
banner changed from "so not shown" to "check them and add", because they are no
longer going nowhere.

`tests/fast/importSummary.spec.js` now asserts both halves: the dialog opens
carrying the stranger's name, AND `db_players` does not contain him — a
proposal, not a write.
## Twelve men were in the registry twice, 2026-09-15

"A player is a record with a stable id, not a name" — and the registry exists
because one bug kept returning in new disguises, one of which CLAUDE.md names
outright: *two analysts labelling one player at different positions*. It had
returned, in the shipped data, unnoticed:

| | records | men held twice |
|---|---|---|
| before | 733 | **12** |
| after resolving the roster by name | 725 | 4 |
| after a placeholder stopped discriminating | **724** | **3** |

Peter Woods was `DL.3T`/Clemson and again `DT`. R Mason Thomas was
`EDGE`/Oklahoma and again `LDE`. His facts land on one record and his board
placement on the other, which is the exact failure the ids were introduced to
end.

**Two causes, both fixed.**

The roster import passed the row's ALIGNMENT to the resolver as though it were
a position — `LDE`, `LG`, `NT`, against the rankings files' `EDGE`, `OG`, `DT`
— so a label from a different vocabulary became evidence of a different man.
`nameMatcher` already says not to do this: "Callers that know nothing beyond
the name (scraped roster data, ESPN sync) pass nothing... do not 'fix' those by
forcing a qualifier through." A roster is that caller, and it was forcing one.
That is eight of the twelve.

And `URA` was being treated as a position. It is the app's own "Unranked
Placeholder", written by the live sync for somebody the board has never heard
of, and the shipped picks file carries rows from such a session. It declares
that the position is UNKNOWN, and it was being read as evidence of a
difference. That is Enrique Cruz Jr, the ninth.

**The last three are left, deliberately.** Uso Seumalo is `DT` and `NT`, Marvin
Jones Jr `EDGE` and `LB`, Jalen McMurray `CB` and `S` — each a UDFA row whose
position in the picks file differs from the one the roster gives him. Closing
these needs either a position taxonomy (that `NT` is interior defensive line,
that `S` and `CB` are not the same thing) or dropping the qualifier from the
DRAFT path as well. The second is not safe: a draft class is exactly where two
different men really do share a name, which is why the qualifier exists. The
first is a football judgement rather than a code one.

## Fixed: a double-click on the draft board took two players

Found by clicking the way somebody clicks while talking, which is what this
app is for. Reproduced every time, on a draft reset to pick 1:

> One double-click on Fernando Mendoza drafted **Mendoza at pick 1 and Arvell
> Reese at pick 2**. Nobody chose Reese. One Undo took back one of them.

The mechanism was the feature working: the Remaining list drops a player the
instant he is drafted, so the card under the cursor is replaced by whoever was
below him, and the second click takes that man.

**Three guards at the click were tried and measured, and none can work.** A
350ms cooldown in `draftPlayer` does nothing — the gap between the clicks is
dominated by re-rendering three hundred cards, so any threshold short enough
to be safe is shorter than the render. `event.detail > 1` does nothing either:
by the time the second click lands, the element under the cursor is a
different card and the browser's multi-click counter resets on a new target.
Which is the finding — **after the re-flow, nothing distinguishes the second
half of a double-click from a deliberate one.**

**So the list holds still instead.** A just-drafted player stays in place for
1200ms and is inert while he does; the repeat click lands on a man who is
already drafted, which `draftPlayer` has always refused. Focus mode never had
this bug for exactly this reason — it leaves drafted cards where they are
rather than filtering them out.

Two things had to be true, and both are measured:

| | before | after |
|---|---|---|
| one double-click drafts | 2 players | **1** |
| one Undo takes back | 1 of 2 | **1 of 1** |
| two DELIBERATE picks, 600ms apart | 2 | **2** |

That last row is the cure being no worse than the bug: the held CARD is inert,
the list is not, so an analyst burning through late rounds is not slowed. And
the repeat click opens nothing — a drafted card normally answers "who took
him" by opening his card, which during a live draft is a modal nobody asked
for, over the Undo button, a third of a second after the pick.

Pinned by `tests/fast/doubleClickDraft.spec.js`, which fails against the old
code with exactly the original symptom.

## The 25s phone boot does not happen on a real phone, 2026-09-16

**Closed by the user, who cleared localStorage and reloaded on his own device
and saw no load time at all** — and that is the COLD boot, the heaviest case,
the one that seeds every collection from the files.

The 25s below is real but it is **emulated**: 390px with the CPU throttled 4x,
standing in for a mid-range handset. That throttle is my choice, not a
measurement of anybody's hardware, and it does not predict the machine the app
is actually opened on.

What stays true: the app does ~18s of parse/compile/DOM work for a thousand
cards **under a 4x throttle**. A genuinely slow device would feel some of that,
and nobody has reported it. Nothing is being changed for it.

**Second time in a day.** The depth-chart drag was the first: measured
correctly, concluded wrongly, overturned in a minute by the user trying it on a
real device. The lesson is not about throttling — it is that **an emulated
measurement is a hypothesis about hardware, and there is a real phone and a
server on 4173 available to test it against.** Ask for that before writing an
entry that says the app is unusable.

### The original measurement, kept for what it does say

The number is real and reproduces exactly. At 390px with the CPU throttled 4x
(roughly a mid-range handset, which is how it was measured originally), a WARM
boot takes **25-26s to show cards, ~22s of it blocked main thread**.

I nearly deleted this entry. Measuring at 390px *without* the throttle gives
4.3s warm and 7.9s cold, and on that basis I wrote that the figure "doesn't
hold" — having skipped the words "with the CPU throttled 4x" in the line above
my own table. **Read the method before contradicting the measurement.**

### "Not a faster match — fewer matches" was the wrong target

Fewer matches was the right instinct aimed at the wrong thing. Three paths were
re-resolving names on the read path, each verified by trace rather than
inference:

| path | before | now |
|---|---|---|
| the scouting pool | 328 resolved by name, every boot | **0** — ids read from board entries |
| `recordDraftFacts` | 629 picks resolved by name, every boot | **0** — the pick already carries its id |
| the draft-pool join | 313 file rows with no id, so ~630 name joins | **reverted, see below** |

None of it moved the wall clock. Across every combination measured, a warm
throttled boot stayed between **24.8s and 33.4s**, and individual runs of the
*same* build spread nearly 3s, so nothing in that range is a result.

### The one that was reverted, and why

Stamping stored ids onto the draft pool before the joins removed the most CPU
of any change here: `getLevenshteinDistance` went from **3572ms of self time —
second only to `(program)` — to absent from the top eighteen**.

It also broke the test suite. Not one test: **a different test failed on each
run** (routing, then faRoundTrip), each passing in isolation, with the baseline
clean at 46 passed across a control run. The change needed `openRegistry()` and
`openBoardEntries()` on the draft path, which is new I/O before first paint,
and under four parallel workers that was enough to push timing-sensitive tests
over their thresholds.

A 3.5s CPU saving that does not move the wall clock is not worth an unstable
suite. Reverted, and written down here so the idea is not lost: it is sound,
and it wants a way to reach the entries **without adding an await to the draft
path** — reading them only if another view has already loaded them, or moving
the opens somewhere they are already being paid for.

### What actually dominates

| | self time |
|---|---|
| `(program)` — V8 internals, parse/compile | **18.2s** |
| `getLevenshteinDistance` | 3572ms |
| `findMatchingIndex` | 895ms |
| garbage collector | 886ms |
| `setValueForStyle` / `appendChild` / `createElement` / `setTextContent` | ~2s combined |

`(program)` dwarfs everything and no change to the matcher touches it. The app
renders three boards of 328 players — roughly a thousand cards — and the cost
is in producing and styling that DOM, not in working out who anybody is.

**The fix that would move this number is rendering less**: virtualising the
board so off-screen tiers cost nothing. That is real work and it is not
started. Recorded so the next person does not spend another night on the
matcher — it has now been chased twice.

## Verified, not assumed: syncing the roster twice, 2026-09-15

The plan asked for this in so many words — *"run it twice in a row with a
manual edit in between — confirm the manual edit survives the second sync,
confirm no existing occupied slot ever gets silently overwritten"* — and it had
only ever been checked in unit tests on the merge function. Driven in a browser
now:

| | |
|---|---|
| first sync | placed nothing: 132 had no matching position row, 238 no free slot, 81 already there |
| hand edit | cut Tyquan Thornton — 91 on the roster to 90, 1 in the cut panel |
| second sync | *"Placed 1 player"* — Harrison Wallace III, into the slot Thornton vacated |
| Thornton | still cut. The hand edit survived |
| displaced | nobody |

This is the behaviour the plan specified, so it is a verification rather than a
fix: the sync only fills. Locked in `tests/fast/rosterSyncTwice.spec.js`.

### The probe said it was two bugs, and both were mine

The first run of this reported *"the hand edit did not take"* and *"the second
sync put Thornton back"*. Neither was true. A cut player is still a `.rv-slot`
and still carries a `.rv-slot-name` — **a cut is a slot now**, not a bare name —
so counting every `.rv-slot-name` on the page gives the same total before and
after a cut. The man had moved, not vanished, and the count could not tell.

What gave it away was a number that disagreed with the conclusion: the skip
reason went from *238 had no free 53-man slot* to *237* across the cut. A slot
had been freed, so something had certainly happened, and "the edit did not
take" could not be the explanation. The fix was to exclude `.roster-cuts-list`
from the roster count and read the cut panel separately.

Seventh probe fault this session, and the same shape as the other six: **the
selector was more general than the claim.** `.rv-slot-name` answers "is this a
slot with a name in it", which is not the question "is this man on the 53".
`tests/fast/irActivation.spec.js` already had this right — it excludes
`.roster-ir` and `.roster-cuts` when it looks for an empty slot. Worth reading
the neighbouring test before writing the selector, not after.

## Verified, not assumed: Free Agency's CSV round-trips, 2026-09-15

Also on the plan's verification list and never driven: *"export/import
round-trips"*. The field-level quoting has good unit tests — they were written
for the `Last, First` comma bug — but nothing exercised the trip through the
real UI: the menu, a Blob download, a file input, and `history.reset` on the
way back in.

Out and back with a drag in between, so an import that did nothing could not
pass:

- 22 position rows out, 22 back
- per-row 53-man slot counts unchanged
- 77 candidates, each back in **the same slot and the same zone**

The zone is the part worth asserting. FA reuses the 53 zone as "top choice" and
the reserve zone as "other options", so a round trip that carried the names but
dropped the zone would silently re-rank every candidate — and the grid would
look perfectly healthy afterwards. Same for the slot index: dropping it would
compact the chart and lose the gaps that mean "nobody yet".

Locked in `tests/fast/faRoundTrip.spec.js`. Roster's CSV is the same shape
through the same grid, so this covers the risky half of both; a Roster-side
equivalent is cheap to add if that path ever changes on its own.

## A write nobody ever answered was never written down, 2026-09-15

The persisted queue exists because of a sentence in its own comment:

> A queue in memory is a queue that a reload throws away, and a reload is
> exactly what somebody does when the app seems stuck.

An unacknowledged write **is** the state where the app seems stuck — the
indicator says `Saving…` and never stops. And that was the one write the queue
did not hold. `attempt()` enqueues on CATCH, so the queue, the retry and the
warning all hang off the adapter's promise rejecting; a write that is neither
accepted nor refused falls between them.

Measured before touching anything, with an adapter whose `set` returns a
promise that never settles (`tests/unit/unacknowledgedWrite.test.js`):

| | before |
|---|---|
| the indicator | `saving` — honest, it never claimed saved |
| `pending_writes_v1` | **empty** |
| after a reload | **the change is gone, with no error anywhere** |

The indicator was already telling the truth, which is why this survived so
long. The gap was only that the truth was not written down.

`initializeFirestore` is called without a local cache, so the SDK's own buffer
is memory-only too — there is no second net underneath.

### The fix, and why it is not a product decision

The mechanism and the stated intent were both already there; one case was
never wired into them. Same shape as the import banner that could not appear.
`persistQueue` now writes down everything unlanded — `pending` (refused) and
`sending` (unacknowledged) — deduplicated by document, `sending` last because
the copy being sent is the newer one.

Two things keep it from costing anything on the way:

- **It persists per write OPERATION, not per document.** `commit` calls
  `startSending` once per change, so persisting inside it would have made a
  328-entry seed quadratic.
- **It waits 250ms first.** A write is only worth writing down once it is slow
  enough to be in doubt. Against localStorage the timer can never fire at all:
  `localAdapter.set` is an `async` function with no `await` in it, so its
  promise settles in a microtask, and microtasks run before timers. Plus a
  `queueOnDisk` flag, so a settled write does not pay a `removeItem` to delete
  a queue that was never written.

### What the benchmark actually showed

An eager version measured +494ms of boot blocking, the lazy one +393ms. Both
are **noise**. Running the identical build against itself four times spread
7191–8872ms — a 1681ms range, wider than either difference:

| | blocking, mean of 6 |
|---|---|
| before | 7400ms |
| after | 7794ms |
| same build vs itself (n=4) | range **7191–8872ms** |

So the benchmark cannot tell these builds apart, and saying the lazy version is
faster would be reading the noise. It is preferred on MECHANISM — a microtask
beats a timer, so the local path provably does no extra storage work — not on
these numbers. Recorded this way so the next person does not re-run it
expecting a difference to appear.

### What this does NOT fix

The reconnect failure recorded on the `firebase` branch is a **different
case**, and this does not close it. There the indicator went from `Saving…` to
*nothing*, which is `inFlight` falling back to zero: the promise RESOLVED, and
the write still never reached the store. A resolved write is removed from
`sending` and correctly stops being held — so a store that lies about success
defeats this entirely.

That remains what the entry there already said it was: a seam decision. The
adapter has to decide when a write has failed, by timeout or by Firestore's own
connection state, because a promise that resolves without landing cannot be
detected from above it.

**The tradeoff taken, stated plainly:** a write persisted and then lost with
the tab is retried on the next boot, and could overwrite a newer value written
elsewhere in between. That is the same bargain the refused-write queue has
always made, and the window is now 250ms wider.

## The phone walk, 2026-09-15: the draft board at 390px

Hunting on the device the user's own bug reports come from. Three facts
measured, one of them the reason a whole class of test cannot run there.

**The list you draft from is off-canvas.** At 390px `.left-panel` sits at
`x: -196` with `visibility: hidden`, behind `.sidebar-toggle.toggle-left` (the
`📊` button). That is by design and it works — the toggle opens it to `x: 1`,
visible. It is written down because it silently defeats any test that waits for
`.left-panel` to be *visible*: `waitForSelector` defaults to the visible state,
so `tests/fast/doubleClickDraft.spec.js` times out at 390px having never
reached its own assertions.

**A tap on a remaining player opens SIGN UDFA, and that is correct.** The
shipped 2026 draft is already complete — 208 picks — so there is no pick left
to make and the remaining players are undrafted signings. Tapping one opens
*"Sign Player … ALREADY KNOWN — PICK HIM RATHER THAN ADDING A SECOND"*,
prefilled. Nearly reported as "tapping a player does not draft him"; it is the
post-draft phase behaving exactly as `draftPhase.js` says it should. Probe
fault number eight, same shape as the others: **the premise was wrong, not the
app.** A draft-phase assertion has to reset the draft first, which is what the
desktop spec already does.

**The double-click guard holds on a phone too.** Verified with the draft reset
and the list opened by its toggle: one double-tap, one player. Locked in
`tests/fast/phoneDraftHold.spec.js`, which runs under BOTH projects — on a
desktop the panel is already open and the toggle is never touched, so it is one
flow on two devices rather than a phone-only copy.

### `playwright.phone.config.js`

The same specs, at 390px with `hasTouch`. Deliberately NOT wired into `npm test`:
most existing specs are not phone-ready, for the `.left-panel` reason above and
others like it, and a config that fails twelve tests by design is worse than no
config. It exists so a flow can be re-driven with a finger when that is the
question, and `phoneDraftHold` is the first spec written to pass under both.

Making the rest phone-ready is real work and is not started.

### An unexplained count, recorded rather than smoothed over

One run of the fast suite reported **43 passed of 44 collected, with zero
failures** — a test that did not run rather than one that failed. There are no
`test.skip`s in the suite. A clean re-run of the same build gave 44/44, and
that is what the write-queue commit rests on, but nothing identified what
happened to the missing test. If it recurs, the thing to capture is the full
reporter output: the runs that showed it were piped through `tail`, which threw
away the per-test lines that would have named it.

## Fixed: you could not add a free-agency candidate on a phone

Found by walking the stage rather than confirming it. The dialog opens, the
fields fill, and the button that submits it is **off the bottom of the screen
with no way to reach it**.

`.modal-overlay` centres its box. `.modal-content` carried `overflow: hidden`
and **no max-height**, so a dialog taller than the viewport hangs off both ends
at once and nothing scrolls to what is hanging off. Measured at 390x844:

| | dialog height | primary action |
|---|---|---|
| on open | 1046px (spans −101…945) | on screen by 1px; "Add as Trade Target" already off |
| after typing a known name | 1161px | **bottom 901 — off screen** |

Typing a name the app knows inserts the "ALREADY KNOWN — PICK HIM RATHER THAN
ADDING A SECOND" list above the actions, which is what pushes them off. So the
dialog broke precisely when it was doing its most useful work.

**Fixed** by giving the base `.modal-content` a `max-height` (92vh, with 92dvh
for the phone's moving chrome) and `overflow: hidden auto` — x stays hidden so
the rounded corners still clip. `.add-prospects` scrolls its own body, so it
keeps `overflow: hidden` explicitly rather than scrolling twice.

A/B, with a swipe rather than a programmatic scroll:

| | primary action | after scrolling |
|---|---|---|
| before | bottom 901, off screen | bottom 901 — **unreachable** |
| after | bottom 1092, off screen | bottom 709 — **reachable** |

This is the base dialog, so the draft's unranked-player form, the UDFA sign
modal and the roster sign modal all sat behind the same rule.

### The probe that passed on the broken build

Worth recording, because it nearly buried this. The end-to-end version —
open, fill, submit, assert the man appears — **passed on both builds**.
`scrollIntoViewIfNeeded` scrolls an element into view by means a person does
not have, so it sailed past the exact defect under test and reported the flow
healthy.

The honest question was "can a FINGER get there": type the name, swipe, and see
whether the button moves. On the broken build it does not move at all. The
regression test asserts reachability without that helper, and it fails on the
pre-fix build with *"the dialog hangs off the top of the screen"* — checked,
not assumed. `tests/fast/modalReach.spec.js`.

## The touch half of drag-and-drop had never been tested, 2026-09-15

Every drag in the suite goes through `page.mouse`. @dnd-kit's TouchSensor is a
different code path from MouseSensor — **delay**-activated (200ms, 8px
tolerance) rather than **distance**-activated, which is what lets a quick swipe
scroll the chart instead of carrying a player off it. The drag-and-drop was
rewritten on dnd-kit precisely for touch, and nothing automated had ever
exercised that half.

Driven now, at 390px, with the gesture dispatched over CDP
(`Input.dispatchTouchEvent`: press, hold past the delay, move, lift — Playwright's
touchscreen only taps):

- a finger drag moves a player — Tyquan Thornton and Xavier Worthy swapped slots
- the roster count is unchanged, so it moved somebody rather than adding or losing one
- a quick swipe leaves everyone where they are, which is the whole point of the
  delay activation

**No bug.** The touch path works. It is now covered by
`tests/fast/touchDrag.spec.js`, which skips where there is no touchscreen, so
it costs the desktop run nothing and passes under the phone project.

### Two probe faults on the way, both caught by a number that made no sense

The first run reported the touch path broken. It was dragging to **x=968 on a
390px-wide screen** — the depth chart scrolls sideways, and my "is it visible"
filter checked `top`/`bottom` and not `left`/`right`, so the first empty slot in
DOM order was off the side of the display. Dragging to a coordinate that is not
on the screen proves nothing about touch.

Constraining to both axes then found *no* empty slot on screen at all, which is
true and is why the test now moves a man onto an occupied slot instead: it
exercises the same sensor without needing the chart scrolled first, and
scrolling would have been a second variable in a test about dragging.

Nine and ten of the session. The pattern holds: **the selector was more general
than the claim.**

## Phone flows driven clean, 2026-09-15

Doing the work, not finding the screen. The layout suite already proves every
stage is REACHABLE at 390px; these are the edits themselves, with a finger.

| flow | result |
|---|---|
| Scouting: tag a player | tag applies, reaches `db_boards/<id>/entries`, survives a reload |
| FA: add a candidate | **was broken** — see the dialog fix above; works now |
| UDFA: sign a player | signs, leaves the undrafted board, survives a reload |
| Roster: drag with a finger | moves a player; a quick swipe still scrolls |

The UDFA dialog's three actions all sit inside the box at 390px, which is the
bug the user reported first — the gold SIGN UDFA a sliver past the left edge.
It stacks now and stays in.

### "The signing was not written anywhere" — wrong twice over

Nearly filed as a data-loss bug. Two separate faults, both mine:

The first search only looked at keys matching `/udfa|draft_state|signing/`.
Collections are path-keyed (`db_seasons/<id>/...`), so guessing at key names
is how a probe reports nothing about a write that landed.

The second was worse, because it *looked* like evidence. Searching every key
for the player's NAME found `db_players` and called that the signing — but the
registry already holds every player, so his name being in it proves nothing,
and the signing itself is filed by `playerId`, which no name search can find.

What actually answers it is which collections **changed**: snapshot storage
before and after, and diff. One did — `db_players` — because the registry is
where an undrafted signing is recorded, which is exactly what `draftPhase.js`
reads back. Then reload and confirm he is still signed.

Eleventh probe fault. Same shape once more: **the evidence was more general
than the claim.**

## Add Players at 390px — the dialog I exempted from the fix

`.modal-content.add-prospects` keeps `overflow: hidden` rather than taking the
new max-height scrolling, because it is a flex column that scrolls its own
body and would otherwise scroll twice. That exemption is only right if the
INNER region actually scrolls on a phone — otherwise I left exactly the bug I
had just fixed, in the one dialog I chose not to fix. Checked, with 14 rows:

| | box | inner region |
|---|---|---|
| entry step | 50…794 of 844 — fits | `.ap-entry-grid` 339px of 746px, scrolls |
| verify step | 50…794 of 844 — fits | `.ap-verify-list` 508px of 5970px, scrolls |

Both primary actions stay on screen (BACK at 696, ADD 14 TO BOARD at 777).
The exemption was correct.

**The commit button is disabled, and that is the feature.** `blockedCount`
counts rows whose name matched somebody already known and has not been resolved
either way, and `submit` refuses while it is above zero — the verification step
Add Players insists on. My 14 probe names matched *each other*, which is the
check doing its job.

And unlike the ROLL OVER button recorded earlier as friction, this one **says
why**: "13 names still to resolve" renders immediately above it, on screen, at
390px. A disabled primary with a visible reason is not a dead button.

## The board CSV round-trips, and the probe that said it lost 81 players

Export a board, feed the file straight back as a new board, and count what
landed. **328 records out, 328 entries stored**, tags and all. The export is
already covered ("markers and all") and seeding a new board from a file is
covered; this was the pair, end to end.

No new browser spec: `tests/unit/boardCsv.test.js` already round-trips
"placement and identity through a multi-line quoted cell", which is the risky
part, and a slow test duplicating fast coverage is not worth the minute.

### Twelfth probe fault, and the worst of the session

It first reported: *"the round trip lost rows: 409 in the file, 328 on the
board — 81 unaccounted, and the banner claimed none were unknown."* That reads
like real data loss, with a storage-level count behind it, and I had already
gone looking for which 81.

What gave it away was reading the supposedly-lost rows instead of counting
them:

```
+ Sticky man-cover corner with a physical presence on the outside
+ Reactive athleticism; reads receivers and route combinations
```

Those are not players. They are evaluation bullets, and **an evaluation
contains newlines**. The exporter quotes them correctly; my probe split the
file on `\n`, so seven multi-line records became eighty-eight lines. 409 lines,
328 records, and the difference is exactly the 81 I was hunting.

The sharpest part: this codebase already fixed the comma version of this bug
and carries an RFC-4180 parser because of it. The probe used a naive split
anyway. **A file format is not a line format**, and counting a CSV by lines is
the same mistake as counting `.rv-slot-name` including the cut panel — the
measure was more general than the claim, for the twelfth time.

## The three registry duplicates are three duplicate ROWS, 2026-09-16

**Resolved 2026-09-16.** The duplicate rows are out of
`public/DraftBoard_Picks.csv`, decided by the user:

| player | kept | removed |
|---|---|---|
| Uso Seumalo | `DL.1T` | the `NT` row |
| Marvin Jones Jr | `Edge` | the `LB` row |
| Jalen McMurray | `CB` | the `S` row |

Verified on a fresh seed: **724 records with 3 duplicated names → 721 with 0.**

### Why the fix belongs in the file and not in the matcher

The rule, from the user: **no merging within one seed file — a seed file has to
be considered truth within itself.**

That is already how this codebase treats rankings files. `joinKeyFor()` joins
boards on the NAME, *except* for a name appearing twice inside a single file,
where it adds position "because the analyst deliberately listed two people".
The same logic applies here: two rows in one picks file are two entries, and
the app making two records was **faithful to the file**, not a matcher fault.

Teaching the matcher to merge same-name rows within a file would look like a
fix and would silently collapse two genuinely different men the day a file
lists them — which is the failure the registry exists to prevent. So the file
gets corrected; the matcher does not change.

### Two things noticed on the way, not acted on

`DL.1T` and `DL.3T` (three rows now, including Seumalo's) did not match the
depth chart, whose rows are `DT.1T` and `DT.3T`: `resolvePosition` compared the
exact label, then the part before the dot, and `DL` is not `DT`. Those players
would not auto-place on a roster sync.

**Fixed the same day** by `positionTaxonomy` — the very problem it was built
for. `DL.1T` now reaches `["DT.1T", "LDE", "RDE"]`, and `NT` the same, so
Seumalo places. Corrected here because the sentence above was written before
the table existed and would otherwise send somebody looking for a bug that is
gone.

The user also stated a second principle, recorded here because it is a
requirement and not yet built: **later expert imports should be reviewed and
decided by an expert before anything is written.** The board-CSV import already
works this way — it proposes its unknown players to Add Players rather than
writing them — but no other import path does.


Filed for a long time as "needs a football position taxonomy". It does not. It
needs three lines deleted from a shipped file.

`public/DraftBoard_Picks.csv` lists each of these men **twice** as a UDFA
signing — same team, different position label:

| lines | rows |
|---|---|
| 588, 591 | `UDFA,Uso Seumalo,DT,SEA` and `UDFA,Uso Seumalo,NT,SEA` |
| 590, 594 | `UDFA,Marvin Jones Jr,Edge,SEA` and `UDFA,Marvin Jones Jr,LB,SEA` |
| 621, 623 | `UDFA,Jalen McMurray,CB,TEN` and `UDFA,Jalen McMurray,S,TEN` |

The app then did exactly what it should: it resolves by name AND position, the
positions differ, so it created a record for each. **This is not a matcher
fault and not a merge problem — it is two rows describing one signing.**

### What the records look like

All six carry no school, `isUdfa: true`, `draftYear: 2026`, and the same team
as their twin. Each pair was created **2-3ms apart**, in one batch, which is the
signature of one file being read once.

And the part that makes this cheap: **every one of the six is referenced by
zero collections.** No board entry, no pick, no roster slot points at either
record. Nothing has to be rewritten, nothing loses its history — a merge here
is deleting an orphan.

### What is still the user's call

Which position survives, for two of the three. `public/player_facts_2026.csv`
settles one of them on the repo's own evidence:

- **Jalen McMurray** — `Jalen McMurray,CB,Tennessee,,,,TEN`. **CB**; the `S` row
  on line 623 is the duplicate.
- **Uso Seumalo** (DT vs NT) — not in player_facts. NT is an interior
  alignment and DT is what he plays, but that is a football judgement and this
  file is the user's data.
- **Marvin Jones Jr** (Edge vs LB) — not in player_facts. Same.

Left alone deliberately. Deleting the wrong row of a pair silently changes what
the app says a man plays, and the shipped data belongs to the person who
compiled it. Two one-word answers finish this; the position-interchangeability
config would finish it generally, and is the larger version of the same
question.

## Wrong: I said the depth chart cannot be dragged on a phone. It can, 2026-09-16

**Corrected the same day, by the user, who tried it.** He dragged a card to the
edge of the screen on his own server and the chart scrolled. Verified here with
a real touch gesture afterwards: holding a card against the bottom edge moved
the IR zone from **y=1967 to y=1527 — about 440px in four seconds**, so roughly
ten seconds of holding to bring IR into reach. Slow, and not something anybody
will enjoy mid-broadcast, but it **works**. The stages are operable.

What follows is the measurement, which was right, and the conclusion I drew
from it, which was not. I had even seen `autoScroll` in the dnd-kit config and
written that holding a card against the edge for several seconds was "not a
thing anybody will do" — dismissing the mechanism rather than trying it. The
user tried it in about a minute.

The three specs that skip at this width skip because **`dragTo` moves and
releases without dwelling at the edge**, so it never triggers auto-scroll. That
is a limit of the harness, not the app, and the guard now says so.

Coming back off IR is a drag from the IR zone to an empty 53 slot. At 390px
those two things cannot be on the screen at the same time:

| | |
|---|---|
| the IR zone | **y = 1967** on an 844px-tall screen |
| empty 53 slots fully on screen, at rest | **0 of 44** |
| after scrolling the chart to reach empty slots | 10 of 44 visible — and IR is **still at y = 1967** |

The roster stacks vertically on a narrow screen (which is the fix for "FA only
shows cuts"), so twenty-two position rows push IR roughly two thousand pixels
down. Scrolling sideways to find an empty slot does not bring it back.

**And it is not only IR.** Measured on both depth-chart stages at 390px:

| view | viewport | IR zone | cut panel | empty slots on screen |
|---|---|---|---|---|
| roster | 844px | y=1967 | y=2132 | **0 of 44** |
| free agency | 844px | y=1936 | y=2057 | **0 of 22** |

So every drag the depth chart is built on — cutting a player, moving him to an
empty slot, bringing him back off IR — has its target more than twice the
screen height below the fold **at rest**. Reaching it means holding the card at
the edge and waiting for the chart to travel, which is what auto-scroll is for.

What made this hard to see is that the automated drags succeed: Playwright
scrolls an element into view before dragging to it, so a spec finishes a
gesture no hand can. It is the same trap as the dialog that "passed" on the
build where its button was unreachable — **a probe that can do what the user
cannot will report the app healthy.** Three specs (faRoundTrip, rosterSyncTwice,
doubleClickDraft) failed on the phone project for exactly this reason and now
skip there, pointing here.

So the gesture requires dragging across ~1100px of vertical scroll while
holding a card. dnd-kit does auto-scroll during a drag, so it is not strictly
impossible — but "hold a card against the edge of the screen for several
seconds while the page travels two thirds of its height" is not a thing anybody
will do on a phone during a broadcast.

**Found via the phone project**, which is what `irActivation.spec.js` is
failing under. The spec's own failure is a mouse-on-touchscreen artifact; the
condition underneath it is real.

### Why this is not mine to fix

The obvious fix is an affordance that does not need a drag — and this app
**had** one. The Activate button was removed deliberately, and the reasoning is
recorded three sections up: *"Injured reserve is a place, not a flag: dropping
a player there puts him on it and dragging him out takes him off, and the
button was a second way of saying what the drag already said."*

That reasoning holds on a desktop and breaks on a phone, where the drag it
defers to cannot be performed. Re-adding a button, adding a phone-only
affordance, or moving the IR zone are three different answers to a question the
user has already ruled on once. Written down, not decided.

### Also corrected: the phone suite is mostly green

The README and `playwright.phone.config.js` said "most existing specs are not
phone-ready". Measured: **38 of 47 pass**. Nine fail, and six of those are one
device mismatch — on a phone the player card opens as a modal, so a desktop
spec that clicks what would be the side panel is blocked by `.modal-overlay`.
None of the nine is an app bug except the condition above.

## The phone suite, made to mean something, 2026-09-16

`playwright.phone.config.js` runs the same specs at 390px with a real
touchscreen. It started at **38 of 47 passing** — not "most specs are not
phone-ready", which is what I had written down without measuring.

Nine failures, and sorting them mattered more than fixing them: a spec that
fails on a phone is either a **device mismatch** (the spec assumes a desktop
surface), a **feature that is deliberately absent** at that width, or a **real
bug**. Only the last is worth a fix, and one of the nine was exactly that.

| failure | what it was | what was done |
|---|---|---|
| six clicks blocked by `.modal-overlay` | at 390px the player card is a MODAL, not a side panel, so anything clicked after looking at a player is behind it | `closeCardModal()` in helpers, called by `gotoTab` — a no-op on a desktop |
| `.scouting-rank-row` not found ×2 | `useScoutingLayout` **drops the ranking column** at narrow widths, by design | the two specs skip, with the reason |
| `.player-card` never visible | the first card in the document belongs to the off-canvas player list | assertion scoped to `.center-board-container` |
| side panels "must not scroll" | both panels are off-canvas at 390px, so there is nothing beside the board to hold still | skips at this width |
| three drag specs | **a real bug** — no depth-chart drag target is on screen at 390px | they skip there, pointing at the entry above |

I first read those three as contention — they drag, export and wait on
downloads, and rendering a thousand cards at 390px is heavy. So I added a
retry. **They failed twice running**, which is what a retry is for finding out:
the cause was structural, not load. The retry came back out and the specs skip
instead. The phone project does run two workers rather than four, which is
honest on its own terms.

**The point of doing this at all:** both real bugs found this session came from
walking the app at 390px — the dialog with no way to reach its submit button,
and IR activation. A phone suite that fails nine specs for uninteresting
reasons is a suite nobody runs, and then nothing catches the tenth.

## Fixed: on a phone the tab bar never showed the stage you were on

Found by taking a screenshot and looking at it, which is the method that has
found every real bug this session.

The tab bar is wider than a 390px screen and scrolls sideways — but it never
scrolled itself. `scrollLeft` stayed **0** with **405px** of scrollable width,
whichever stage was open:

| stage you are on | the tab for it |
|---|---|
| Free Agency, Scouting | visible |
| Draft Board | **cut in half** |
| UDFA, Roster | **off screen entirely** |

So on two of the five stages the bar showed three stages you were *not* on and
nothing at all to say where you were. On a broadcast, on a phone, that is the
one piece of chrome whose whole job is orientation.

**Fixed** in `App.jsx`: a ref on the active tab and an effect that calls
`scrollIntoView({ inline: 'nearest' })` when the view changes. `nearest` means
a tab already fully visible does not move, so a desktop scrolls nothing.
Measured after: every stage fully visible, the bar scrolling 0 / 0 / 45 / 138 /
250 as you move along it.

### The test passed against the broken build, first time

`tests/fast/activeTabVisible.spec.js` originally walked the stages with
`gotoTab`, which **clicks** each tab — and a browser scrolls an element into
view when you click it. The test was creating the condition it was asserting,
and passed against the very build whose screenshot had just shown the bug.

It now navigates to `/?view=<stage>` instead, arriving cold the way somebody
does when they reopen the app. Against the unfixed build it fails with
*"arriving at draft, its tab (📋 DRAFT BOARD) is not fully on screen"*.

**Thirteenth probe fault, and the third of exactly this kind** — after the
dialog that "passed" because `scrollIntoViewIfNeeded` reached a button no hand
could, and the depth-chart drags that pass because Playwright scrolls to a drop
target the user cannot see. The rule those three share is worth stating once:
**a test that performs the user's gesture with the browser's powers is not
testing the user's experience.**

## What a man plays versus where he stands, 2026-09-16

Three vocabularies described the same football and nothing translated between
them: rankings files say what he **plays** (EDGE, IOL, OT), the picks file says
whatever its source said (DE, OG, DT), and the depth chart says where he
**stands** (LDE, LG, DT.1T). `utils/positionTaxonomy.js` is that translation.

**Two relations, and the difference is the safety property.**

- **Containment** — a position and the rows it covers: `OT: [LT, RT]`,
  `IOL: [LG, C, RG]`, `EDGE: [LDE, RDE]`. A fact about football. It NORMALISES
  a label, so it is safe for identity: LDE and EDGE are one man written twice.
- **Compatibility** — two DIFFERENT positions that can fill each other's rows,
  `OT ↔ IOL`. Also objective, declared once rather than judged per player. It
  must **never** touch identity: collapsing OT and IOL would merge two men who
  share a name, one a tackle and one a guard — the failure the registry exists
  to prevent, arriving through the front door.

So: **identity uses containment only; placement uses both.**

### What it fixed, measured

| | before | containment + compatibility | + groups |
|---|---|---|---|
| roster sync: "no matching position row" | **132** | 52 | **21** |
| roster sync: "no free 53-man slot" | 238 | 315 | 346 |
| position labels reaching no row at all | — | 5 | **2** |

The 21 that remain are **URA** — players whose position is not stated at all.
That is the correct floor: a label that declares nothing cannot place anybody.
The other unresolvable label is a CSV header line my probe read as data.

Eighty players who could not find a row now find one, and move to "no free
slot" — which is correct, because the roster is already at 91. That is bug #22,
deferred since it was found. The three-player difference in the totals is
exactly the three duplicate rows deleted from the picks file, so the accounting
closes.

For identity, `basePos` now folds through containment before comparing.
`tests/unit/crossBoardIdentity.test.js` carried a test named *"does not find him
when qualified by the alignment — **this is the bug**"*, pinning the Diego
Pounds failure — the third time that shape had landed. It now asserts the fix:
LT **is** an OT, and the lookup finds him. A guard row still does not.

### The rules inside it

- A **sub-type is the same man described more precisely**: DL matches DL.1T,
  because a nose tackle IS a defensive tackle — that was the Seumalo pair. But
  DL.1T and DL.3T stay apart, since both declared a sub-type and they differ.
- A row maps back to the **narrowest** position that covers it, so DT.1T reads
  as DL.1T rather than plain DL.
- `DB`, `OL` and `WR/TE` are **deliberately absent**. They name a group, not a
  position, and guessing which half is meant is how a wrong record gets written
  confidently. They fall through unchanged.
- **A third relation: GROUPS.** `OL`, `DB` and `WR/TE` name a group rather
  than a position, and refusing to guess left 37 players unplaceable. They now
  reach every member's rows, and `resolvePosition` already prefers the emptiest
  — so an OL lands wherever there is most space, without anybody deciding he is
  a guard. Placement only, one direction: reading a man out of the LG row still
  says IOL, never "some offensive lineman", and a group is never canonicalised
  to a member because that would be the guess all over again.
- **The three tables are an expert's opinion and want to live in Settings**,
  beside positional value, which is already global and already editable. Not
  done. Worth noting when it is: compatibility and groups are safe to edit
  freely, because they only widen where somebody may be placed. Containment is
  not — it is what identity compares through, so a careless edit there stops
  two labels matching and mints duplicates.

## Standing work, ordered by the user

1. Season rollover — done
2. Deep audit, desktop and 390px — done for the local app; redone above against Firebase
3. Firebase migration — in progress on branch `firebase`; the app reads a
   season out of Firestore, a viewer follows an expert's board, and an expert's
   writes reach the shared store. Remaining: a sign-in control, and deploy config.
