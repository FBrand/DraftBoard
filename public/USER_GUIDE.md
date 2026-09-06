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
the class. There are three: **Consensus**, and one for each analyst. Switch
between them in the left panel — they are genuinely different boards, not
different views of one list.

### Ranking a player

Every player sits in a **round** and a **tier** inside it (shown as `2.1`,
`2.2`, and so on), and has a position within that tier. Three ways to move him:

- **Drag his card** to where he belongs.
- **Type a total rank** on his card. This is a *move*, not a label: he takes
  that slot and everyone between his old and new spot shifts by one. Two
  players can never end up sharing a rank.
- **Drag him into a different tier row** to re-tier him.

**Total Rank** and **Position Rank** are counted off the board itself, so they
can never disagree with where a card actually sits.

### Unranked players

A player someone else has ranked and you haven't is **unranked** on your board,
not missing from it — he shows as `???` and sits in the `UR` row at the bottom.
That is deliberate: he has to be on your board for you to disagree about him.
The **Unranked** filter in the top bar shows only these.

Unranked is a separate thing from a tag — a player can be liked *and* unplaced.

### Tags and remarks

Click a player to tag him — **Like** ★, **Avoid** ❗, **Monitor** 🔎 or
**Injury** ✚. A star in a rankings file becomes a Like, so the star and the tag
are one mechanic rather than two that can disagree. In a spreadsheet the tag
column takes either the symbol or the word.

Behind the ✏️ pencil on a player's card you can record **strengths (+)**,
**weaknesses (−)** and **notes (•)**. These belong to the person who wrote
them, not to the board, so they keep growing across seasons — a note you made
two drafts ago is still on the player's card today.

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
- **Focus view** shows everyone, dimming the players already gone.
- **Undo** steps back through picks if a pick was entered wrong.
- Your own picks are marked, and the panel tracks which of them are left.

Each pick records the year, the overall pick number and the team. The **round
is never guessed from the pick number** — compensatory picks make that
arithmetic wrong from the third round on, and a confidently wrong round is
worse than a blank one.

---

## 🪧 UDFA

Once the last pick is in, the UDFA tab opens. It is the same board grid showing
exactly who is left, so priority free agents are picked off the same list you
spent the spring building.

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

Scouting, Free Agency, Roster and the Draft board each export CSV; Scouting
and the two depth charts import it back. The formats below are meant to be
typed in Google Sheets by hand — if a file only has to reach the app, that is
all you need to write.

UDFA has no file of its own: its signings are part of the draft, and they come
out in the draft export alongside the picks.

**A board** is `round, tier, name, position, school, tag, evaluation` —
Scouting's **Export Board for Sheets** and **Import Board from Sheets**. The
evaluation cell holds remarks, one per line, marked by the symbol:

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

Importing a board **replaces that board's ranking** — a ranking is an ordering,
and merging two produces an order nobody wrote. Players in the file that the
app has never seen are created; remarks are added to what you already have,
so re-importing a corrected file will not leave you with two copies of a note.

**Roster** rows are `Phase, position, slots53, then the players in order`.
`R:` in front of a name means a reserve/practice-squad slot. A suffix after a
name records how he arrived — `:24/1` drafted 2024 round 1, `:5` drafted in
this year's fifth round, `:UDFA`, `:FA` free agent, `:TR` trade. The app
splits those off on import and rejoins them on export, so a round trip through
the file loses nothing.

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
