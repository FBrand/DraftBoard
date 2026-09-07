# DraftBoard — User Guide

DraftBoard follows one NFL offseason from the end of a season to the day the
roster gets cut to 53. It is built to be **shown**: the board is what your
audience watches while you talk, so everything here is meant to be operated
live without breaking your train of thought.

Everything is saved in your browser as you go. There is no login and no server
— close the tab, come back, and your work is where you left it.

---

## The five tabs

The tabs across the top are the offseason in order. You can move between them
freely and go back at any time; nothing locks.

| Tab | What it is for |
| --- | --- |
| 💰 **Free Agency** | Who you have, where you're thin, and who you're considering |
| 🔎 **Scouting** | Building your draft board — ranking, tiering, tagging |
| 📋 **Draft Board** | The live draft: making picks, tracking the run |
| 🪧 **UDFA** | Signing the players who went undrafted |
| 🏈 **Roster** | The 53-man depth chart, practice squad and IR |

---

## Starting a session

**Session → Load Current State** loads the 2026 offseason as it actually
happened: free agency done, the draft completed, UDFAs signed, and the roster
as it stood going into cutdowns. Use this when you want to talk about the real
offseason, or to demo the app with real data in it.

**Session → Start Clean Slate** empties every stage so you can build a season
from scratch. It asks first, and it clears everything — this is the one action
you cannot undo.

**Session → Export Full Session** writes every stage to a single JSON file, and
**Import Full Session** reads one back. Use it to move your work to another
machine, to hand a board to someone else, or to keep a snapshot before you try
something drastic. The per-tab CSV exports are separate and narrower; the
session file is the whole thing.

---

## 🔎 Scouting — building a board

This is where most of the work happens. A **board** is one person's ranking of
the class. The app ships with **Consensus** and one per analyst, and you can
make more — they are genuinely different boards, not different views of one
list. Switch between them with **BOARD** in the top bar; past three boards the
personal ones move into a dropdown so the bar stays readable.

The screen reads left to right: your **ranking** in order, the same players
**grouped**, the ones the grouping can't place, and the card for whoever is
selected. On a phone you get the grouped list alone.

### Reading the board

**GROUP BY** arranges the same players three ways — by **position**, by
**school**, or by **round**. It changes how they are laid out, never where
they sit. Click a group header to collapse it.

Each grouping leaves somebody out, and that is the point: grouped by school
it's the players with no school recorded, by round the ones nobody has ranked,
by position the ones nobody has labelled. They get their own **Unmatched**
column, and each row says what it's missing — a worklist of gaps worth filling.

### Ranking a player

Every player sits in a **round** and a **tier** inside it (shown as `2.1`,
`2.2`, and so on), and has a position within that tier. Three ways to move him:

- **Drag him by the ⠿ handle** in the ranking column on the left.
- **Type a total rank** on his card. This is a *move*, not a label: he takes
  that slot and everyone between his old and new spot shifts by one. Two
  players can never end up sharing a rank.
- **Set his Round and Tier** on his card to re-tier him.

**Total Rank** and **Position Rank** are counted off the board itself, so they
can never disagree with where a card actually sits.

### Making a new board

**More → New Board…** takes a name, an author, and optionally a CSV to start
from. The CSV is optional on purpose: an empty board is a perfectly good
start — every player shows as unranked until you place him.

An author is who is writing it; leave it blank for a board nobody owns, which
is what Consensus is. Reusing a name reuses that person, so one analyst keeps
one identity across boards and seasons.

### Unranked players

A player someone else has ranked and you haven't is **unranked** on your board,
not missing from it — he shows as `???` and sits in the `UR` row at the bottom.
That is deliberate: he has to be on your board for you to disagree about him.


**Unranked** is one of the filters in the top bar, alongside the tags.

### Tags and remarks

Click a player to tag him — **Like** ★, **Avoid** ❗, **Monitor** 🔎 or
**Injury** ✚. A star in a rankings file becomes a Like, so the star and the tag
are one mechanic rather than two that can disagree. In a spreadsheet the tag
column takes either the symbol or the word.

On a player's card you can record **strengths (+)**,
**weaknesses (−)** and **notes (•)**. These belong to the person who wrote
them, not to the board, so they keep growing across seasons — a note you made
two drafts ago is still on the player's card today. Everywhere except Scouting
they sit behind the **✎** pencil, so a card you opened to read can't collect a
stray keystroke mid-broadcast.

A player nobody has touched can be deleted. Once he has been placed, tagged or
written about, he can't — the card tells you which boards hold him and offers
to clear **your** opinions instead. Deleting was never meant to be a way to
lose somebody else's work.

### Adding a player who isn't in the file

**+ Add Players** in Scouting is the only way to create a player who is in no
rankings file — late declarations, risers, anyone missed. Type rows in by hand
or paste a CSV; either way you land on the same verification step, and
**nothing is saved until you submit it**. An import is a proposal, not a bulk
write.

An added player arrives **unranked** and is not marked as special in any way.
From that point he is just a player: edit him, tag him, rank him, draft him
like any other.

Two players may share a name as long as the position or the school differs —
that really happens in a draft class, and the app will not merge them.

### Settings

**Scouting → Settings** holds the **positional value** order and the
**athletic matrix** weights. Both are global rather than per board: if analysts
disagree about what a position is worth, that belongs in where they place
players, not hidden in a default that quietly makes their boards differ.

---

## 📋 Draft Board — the live draft

Position columns across, rounds and tiers down. Click a player to draft him.

- **Normal view** hides drafted players and collapses emptied rows, so what's
  left is what you see.
- **⛶ Full Board** shows everyone, dimming the players already gone.
- **Undo** steps back through picks if a pick was entered wrong.
- **+ Draft Unranked Player** takes somebody who isn't on the board at all.
- Your own picks run along the bottom — scroll them with the wheel. UDFA
  signings are not among them; those belong to the UDFA tab.
- **More → Save Picks / Load Picks** writes this draft's picks to a CSV and
  reads them back. That is the *picks*, not the whole app — Session in the tab
  bar is the one that covers every stage.

**✎ Edit Board** makes the board itself draggable during the draft, because a
player rises on the Friday night and the board has to say so before you are on
the clock. Drop a card:

- **on empty space in a cell** to move him to that round and tier;
- **on another player** to put him directly above that man;
- **in a different column** to correct his position — that is a fact about
  him, so it follows him onto every board.

It is off by default. Mid-draft, a stray drag is expensive.

Each pick records the year, the overall pick number and the team. The **round
is never guessed from the pick number** — compensatory picks make that
arithmetic wrong from the third round on, and a confidently wrong round is
worse than a blank one.

---

## 🪧 UDFA

Once the last pick is in, the UDFA tab opens. It is the same board grid showing
exactly who is left, so priority free agents are picked off the same list you
spent the spring building.

Clicking a player opens a **signing form** rather than signing him outright —
a signing records a club and a league-entry fact, and that shouldn't happen on
one click during a broadcast. It arrives prefilled with what the app already
knows, including his school.

- **Sign UDFA** signs him to the team in the Team field.
- **Sign · No Team** marks him signed but unassigned, for when the club isn't
  settled yet.
- **Minicamp Invite** records an invitation rather than a signing.

Everyone you have signed shows in the **Signed** panel on the right — the board
shows who is *left*, so without it your own signings would vanish the moment
you made them. The counter counts your team's, not the league's, and
**More → Export / Import Signed UDFAs** moves them as CSV.

---

## 💰 Free Agency and 🏈 Roster

Both are depth charts: position rows, with slots for the 53, the practice
squad, IR and cuts. Drag players between slots and rows; drag a row to reorder
it.

**Free Agency** holds *candidates* — people you are considering — and flags
which positions are still short-handed by reading your actual roster. It never
writes to the roster on its own.

**Roster** is the real thing. **Sync from FA/Draft/UDFA** pulls in your draft
picks, UDFA signings and FA choices, filling empty slots only: it never
overwrites a slot you have already filled and never removes anyone. Run it as
often as you like — after the draft, again after UDFAs, again later — and your
hand edits survive every time.

Both import and export CSV, so a roster can be bulk-edited in a spreadsheet.

---

## Working with spreadsheets

Every stage moves data as CSV, and the formats are meant to be typed in Google
Sheets by hand — if a file only has to reach the app, that is all you need to
write. Free Agency, Roster and UDFA each offer a **Download CSV Template** next
to their import, so you never have to guess the columns.

Scouting has one way in and two ways out. **+ Add Players** is the way in: type
players by hand, or import a CSV — the **Download template** button inside that
modal gives you the exact columns. Whichever you use, you land on the same
verification step, and **nothing is written until you submit it**.

The columns are `name, position, school, tag, round, tier, rank, matrixTotal,
matrixPosition, evaluation`. Only the name is required. The evaluation cell
holds remarks, one per line, marked by the symbol:

```
Remarks:
+ Elite arm talent
- Footwork under pressure
• Two-year starter
```

The `Remarks:` prefix on the first line matters: without it, a cell starting
with `+` or `-` is treated as a formula by Sheets and Excel and the contents
are mangled. Lines with no symbol are kept as notes, and any of the dashes a
word processor might produce counts as a weakness.

An import **adds to** the board rather than replacing it. Players the app has
never seen are created; anyone already on the board arrives marked **"Updating
— his tier, tag and remarks come from this row"**, which is the normal case for
a file of evaluations. You can undo that on any row, open the existing player's
card, or drop the row. Players you leave out of the file are left alone.

`evaluations_kc_2026.csv` ships as a worked example: the seven Chiefs picks
from the 2026 draft with ten to fourteen remarks each, sourced from Bleacher
Report's scouting reports. Import it through **+ Add Players** to see what a
filled-in board looks like.

**Export Board CSV** writes the same columns back out, so a board round-trips.
It is also a seed file: drop it into `public/` or load it with `?rankings=` and
the app reads it. There is only one board format — the old three-column
`group,name,position` files still load, because their columns are a subset of
this one.

**Roster and Free Agency** rows are `Phase, position, slots53, then the players
in order`. Importing one **replaces the whole depth chart** — it is a bootstrap,
not a way to add one player; use **+ Sign Player** or **+ Add Candidate** for
that.
`R:` in front of a name means a reserve/practice-squad slot. A suffix after a
name records how he arrived — `:24/1` drafted 2024 round 1, `:5` drafted in
this year's fifth round, `:UDFA`, `:FA` free agent, `:TR` trade. The app
splits those off on import and rejoins them on export, so a round trip through
the file loses nothing.

**UDFA** exports and imports your signings as `name, position, school, team`.
An imported row is signed exactly as the button would sign it, so it records
the same facts.

**The draft's picks** are their own file, under Draft → More → Save Picks.

---

## Things worth knowing

**A file only ever starts a board off.** Once a rankings CSV has been read,
the board lives in your browser and the file is never consulted again. Editing
the file later changes nothing until you explicitly import it.

**Boards freeze at the end of a season, evaluations don't.** Starting a new
season archives the old boards and gives everyone a fresh, empty one — a new
draft class is entirely new players, so carrying placements forward would
assert judgements about people nobody has watched yet. The rankings freeze;
what you know about a player keeps growing.

**Facts and opinions are different things.** Where a player was drafted, what
team has him and what he scored on the athletic matrix are facts — they live
on the player and are the same on everybody's board. Round, tier, order, tag
and remarks are opinions and belong to whoever holds them.

**If something looks wrong, export your session first.** A JSON export takes a
second and gives you a point to come back to.
