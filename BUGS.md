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
| 23 | **Storage runs out at about five seasons** | Measured: one season is 834KB, of which board entries 349KB, the registry 263KB and picks 187KB. At 500 players a season that is ~1.05MB, against a localStorage quota of 5MB — so it fails somewhere in season three to five, and the failure is the app refusing to save. Trimming the records helps and does not solve it; the structural answer is archiving old seasons out of the browser, or a backend. A pick document is 268 bytes to say four things and could be ~60, which is worth ~150KB a season if it becomes the difference. |
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

## The storage audit, 2026-09-15

Three bugs in code on this branch, all found by driving the app rather than
reading it. The shared-backend work that surfaced two of them lives on the
`firebase` branch, which sits on top of this one; the fixes belong here
because the code they fix is here.

| # | What | State |
|---|---|---|
| C1 | **One early write hid a whole collection** | A write has to prime the in-memory copy — `applyLocal` and `commit` both do, or a change would not show until the store agreed — and `ready()` read a primed cache as a loaded collection. So one document written before a collection loaded became the whole collection, and the store was never asked. `restoreQueue` documents this exact trap (A4) and guards it by hand. **Fixed:** a `loaded` set that only a completed `adapter.load` adds to. **Verified:** `tests/unit/readyAfterWrite.test.js` fails without it. Invisible against localStorage, where the write went to the same place the read would have come from — which is why it needed a store that answers late to find it. |
| C2 | **Placement documents carried evaluation data, spelled out in full** | `entryFields.lean()` passes a key it does not recognise straight through under its LONG name, and `saveEntry` spreads the whole display shape over the stored one — so an ordinary edit wrote `strengths`, `weaknesses` and `notes` onto a board entry, as empty arrays, on the largest collection in the app. Remarks moved to `evaluations/{player}/remarks` precisely so they would stop riding along on boards, and short field names are most of why this collection fell by 76%. One unrecognised key undoes both. **Fixed:** `filed()` writes the fields an entry declares and drops the rest — a whitelist, because a blacklist fixes today's leak and leaves the next one for production. `athleticMatrixTotal`/`athleticMatrixPosition` were missing from the map too, and would have leaked the first time a board overrode one. |
| C3 | **The boot froze the main thread for 13 seconds** | Not slow — frozen: no scroll, no click, no repaint, worst single task 3.4s. It surfaced sideways: a loop asking the page a trivial question every 500ms was taking five seconds an answer, and an evaluation cannot be slow on its own. A CPU profile put 1.96s in `getLevenshteinDistance` and 1.64s in `basePos`, both fuzzy name matching, both doing work nobody wanted — the distance function computed the full matrix when the caller rejects anything past 2, and `discriminates()` re-folded position and school for every candidate on every lookup. **Fixed and measured:** blocked time 13,067ms → 7,247ms, worst freeze 3,402ms → 1,507ms; the browser suite went 8.4m → 7.2m without being touched. No behaviour change — 51 identity-matching tests and all 37 browser tests. |

| C4 | **The player registry was rewritten 83 times at boot** | Importing a roster resolves one player per slot, and each resolve that created somebody committed the WHOLE collection: 83 rewrites of an 89KB key, 0.55 MB of localStorage writes, for a 91-player roster. `resolveAll` commits once for a list and the parser cannot use it — it needs an id back while it is still parsing the line. **Fixed:** the lookups stay one at a time, the writes batch, and a player minted mid-batch stays visible to the next lookup so the import cannot mint him twice. **Measured:** 83 rewrites -> 7, and 179 localStorage writes at boot -> 103 (0.66 MB -> 0.46 MB). It does NOT move the startup freeze — `setItem` was only ~90ms of that 7.2s, which is the separate C3 story. |

**Not bugs, checked rather than assumed:** tagging a player shows, stores and
survives a reload; entries carry only single-character field names after an
edit.

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

**One piece of friction, not a bug.** Rolling over needs a year typed in —
`disabled={busy || !year}` — while the field shows the obvious answer as a
greyed placeholder. So the screen reads "ROLL OVER, 2027" with the button
dead, and it is not obvious the number has to be retyped. Defaulting the field
to `current.year + 1` would cost nothing; left alone because the confirmation
text below it is doing deliberate work and this is the user's call, not mine.

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

Neither is reachable today — `STATE_VERSION` is 1 and has never been bumped.
They are the kind of thing that is only ever found before it matters or long
after: the whole point of a version hook is to be correct on the day somebody
raises it, and this one would have been silently inert.

## Still open, and worse than it looked: the app is unusable on a phone for 25 seconds

The 7.2s of blocked main thread (C3) was measured on a desktop-class box with
nothing else running. The people this app is FOR are following a broadcast, and
many of them are on a phone. Measured at 390px with the CPU throttled 4x, which
is roughly a mid-range handset — the number is not "long tasks", it is how long
somebody stares at something they cannot use:

| | first visit | second | third |
|---|---|---|---|
| answers a tap after | **46.9s** | **29.7s** | **25.1s** |

A warm boot is only 37% cheaper than a cold one, so this is not a first-run
cost paid once per browser. **Every visit costs 25 seconds.**

It is not the rendering. Forcing each stage to be the one restored at boot:

| stage | responsive at | DOM nodes |
|---|---|---|
| draft | 47.8s | 5117 |
| roster | 39.9s | 944 |
| free agency | 39.3s | 782 |
| scouting | 34.3s | 1470 |
| udfa | 27.4s | 485 |

UDFA renders 485 nodes and still takes 27 seconds. There is a floor of roughly
25 seconds of work that happens whatever is on screen — the shared boot path:
read three rankings files, union them, resolve every player against the
registry, seed the boards, apply the facts.

### Where it goes, and why three fixes did not help

Profiled by inclusive time on a WARM boot, which is the common case:
`loadInitialData` 1.5s, `findMatchingIndex` 1.5s (of which `findJoin` 1.0s and
`getLevenshteinDistance` 0.7s), React rendering 1.2s, `resolveAll` 0.5s.
Multiply by four for the phone.

Then counted, rather than guessed at — every call to the matcher on one boot:

| | cold | warm |
|---|---|---|
| lookups | 5,602 | 4,001 |
| hits on strategy 1 (exact normalised name) | 1,188 | 1,821 |
| hits on strategies 2, 3, 4 | **0** | **0** |
| hits on strategy 5 (Levenshtein) | 3 | 0 |
| misses | 1,202 | 334 |
| average list length scanned | 196 | 308 |

**Three optimisations were tried, measured, and reverted:**

1. Deferring `RightPanel`'s auto-scroll past the first paint (its rect reads
   cost 764ms). Blocked time 7,165ms -> 7,588ms.
2. Collapsing strategies 1-4 from four list scans into one, priority preserved.
   7,165ms -> 7,266ms and 7,546ms.
3. Giving the index first-occurrence Maps so the exact strategies are O(1) —
   aimed straight at the table above, where every hit is strategy 1. Warm got
   somewhat cheaper (29.7s -> 24.1s on the phone) but cold did not move at all,
   and three desktop runs came out at 9,359 / 7,665 / 8,286ms against a 7,326ms
   baseline. Worse, for more code, in the area this project has had the most
   bugs in.

The third one explains the other two. Making HITS cheap changes little, because
the cost is in the MISSES: each one falls through to strategy 4, a substring
test against every player in the list, and then the distance pass. 1,202 misses
on a cold boot against a list growing to a thousand is the O(n squared) that
nothing local will fix.

### What would actually fix it

Not a faster match — fewer matches. The files arrive as names on every boot, so
the whole pool is re-resolved against the registry every time, even though the
registry already has an id for almost everybody and the board entries already
store `playerId`. Persisting the name-to-id resolution and consulting it first
would make a warm boot nearly free, and leave the cascade for names it has
genuinely never seen.

That is a design change with a real failure mode — a stale entry maps a name to
the wrong player, which is precisely the bug this codebase has fought hardest —
so it is written down rather than attempted: it wants deciding, not slipping in.
## Standing work, ordered by the user

1. Season rollover — done
2. Deep audit, desktop and 390px — done
3. Shared backend — on the `firebase` branch, which is this branch plus that
   work. Nothing about it is on this branch, deliberately.
