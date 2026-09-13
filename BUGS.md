# Bugs and complaints

Everything reported, with what actually happened. Kept because things were
getting fixed and then quietly re-broken, and because "fixed" claimed without
a measurement has been wrong more than once here.

**Status means:**
`OPEN` — reported, not fixed.
`FIXED` — fixed *and* verified by measuring or looking at it, not by reasoning.
`CLAIMED` — I changed something and have not verified it. Treat as open.

---

## Open

Nothing open.

## Fixed this round

| # | Reported | What it was |
|---|---|---|
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
