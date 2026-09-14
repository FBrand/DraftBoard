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

## Standing work, ordered by the user

1. Season rollover — in progress
2. Firebase migration — documented in `ROADMAP.md`, not started
