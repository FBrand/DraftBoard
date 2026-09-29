# DraftBoard — the product

A description of the finished thing: what it is, who uses it, and what it does.
Compiled from the instructions given over the course of the project. Not how it
is built.

---

## 1. What it is for

A broadcast companion for RGR Football. Ryan and Daniel work their boards in
the app, live on stream; their audience watches and plays along. The point is
that they get better tooling and the broadcast gets a better presentation than
a spreadsheet on screen.

It covers a whole NFL offseason in five stages — Free Agency, Scouting, Draft,
UDFA, Roster — with each stage feeding the next where that makes sense.

---

## 2. The stages

### Free Agency

Not a signings tracker and not a budget tool. It shows **needs and possible
solutions, as snapshots**: which positions are thin, and who could fill them.

It looks like the Roster — the same depth-chart shape — but the slots hold
candidates under consideration rather than players on the team. It starts from
last season's closing roster, because that roster is what free agency acts on.
Candidates come from a free-agent list or are entered by hand, the same way a
player is signed in the Roster view.

Zones are roster, reserve, IR and cuts. No practice squad.

### Scouting

Where a board is **built from the ground up**. Not a view for comparing your
list against a consensus.

The centre is a collapsible list grouped by position, school or round. On a
computer: the ranking on the left, the grouped list beside it, then players who
could not be matched to a group, then the active player's details. On a phone:
the grouped list alone, with unmatched players at the bottom.

You can filter to players somebody else has evaluated but you have not. You can
reorder the ranking by dragging, on the board and on the list. Typing a rank
moves the player to that position and everybody between shifts by one — two
players never hold the same rank.

### Draft

The live board: positions across, rounds and tiers down.

Normal view hides players who are gone and collapses a tier once it is empty —
a whole tier, never a single player out of one. Focus view shows everything.
Clicking a player takes him. Undo is available everywhere and applies to the
stage you are on.

An expert sets how many picks each round holds; it is not calculated.

### UDFA

The same board as the Draft, after the draft is finished, with the labels
changed. It stays shut until the draft is done. Players who went undrafted are
still available here, and you can sign someone who was never ranked.

### Roster

The 53, the practice squad, injured reserve and cuts. Players move by dragging.

Dropping a player on injured reserve marks him injured; taking him off makes
him active again. There is no separate activate button. Specialists behave like
every other player.

It fills from the earlier stages on request: free-agency candidates, your draft
picks and your UDFA signings. Filling only ever adds — it never overwrites
something placed by hand, so it is safe to run again at any point. Anyone the
depth chart has no place for goes to cuts rather than disappearing.

Colours carry meaning: veterans white, this year's draft picks strong gold,
UDFAs light gold, free-agent arrivals blue.

---

## 3. Players, boards and opinions

Three different kinds of information, kept apart:

**What is true about a player** is the same for everybody: his name, position
and school, his athletic matrix scores, and — once he has entered the league —
his draft year, round and pick, his team and his previous team. Not
measurements. Not contracts.

**What a board says about him** belongs to that board: his tier, where he sits
inside it, and his tag.

**What a person writes about him** belongs to that person: strengths,
weaknesses and notes, each attached to the season it was written in. These
follow the player from year to year, so a picture of him builds over time.

Other rules about players:

- Two players may share a name as long as position or school differs.
- A player nobody has placed is **unranked** — shown as `???`, not as the worst
  player on the board.
- Every board carries every player. Someone one analyst ranked and another did
  not appears as unranked on the second board, not missing from it.
- Total rank and position rank are worked out from where a player actually sits,
  so they can never disagree with the board.
- Athletic matrix scores are global, not per board. Where scores are present,
  the card links to where the matrix can be bought, and that address is
  configurable.

### Tags

Four: **like** (★), **avoid** (❗), **monitor** (🔎) and **injury concern** (✚).
A star in an imported ranking file is the same thing as the like tag — one
mechanism, not two.

### The player card

Opens from anywhere outside Scouting with a secondary click or a long press,
and works in Free Agency and on the Roster as well as on the boards.

It shows the numbers — total rank, position rank, athletic matrix total and
positional matrix — and bullet lists for strengths, weaknesses and notes.

It shows **every** evaluation of that player, from every author, not just one.
Remarks are grouped under the author's name as a common heading, with no
separate heading per kind, and only where something has actually been written.
Facts with no value stay hidden.

Read-only by default outside Scouting; one pencil unlocks the card for editing.

---

## 4. Adding players

Experts add players who are not in any ranking file.

Entry is a bulk form: one player per row, Tab across the fields, Enter to start
the next row, and Enter on an empty row — or the button — to submit. A CSV
import in the same shape feeds the same form.

Both routes end at a **verification step**, and nothing is written until that
step is submitted. It shows every player being added, three rows each: the base
information, the numbers, and buttons for adding strengths, weaknesses and
notes. Collisions with existing players are flagged and block submission, and
always offer to open the existing player's card rather than dead-ending. This
has to be quick enough to use while watching a player live.

Position is entered as free text alongside a dropdown of depth-chart positions.
Only one is required and the empty one takes the other's value; if the free
text does not match a depth-chart position, the form stays open and says so.

A player added this way arrives **unranked** and is otherwise an ordinary
player. There is an Unranked filter to find them.

---

## 5. Seasons

An offseason is a season, and seasons stack.

Old seasons stay available and feed the next: players, draft picks, evaluations,
and the closing roster that free agency starts from. A past season is
read-only while a newer one is open.

Rolling over starts a new season: each author gets a fresh, empty board,
because a new draft class is new people. The roster carries forward; free
agency starts from it.

Rolling back scraps the current season and returns to the previous one, which
becomes editable again. A scrapped season is gone, and you are warned before it
happens.

Boards are artifacts. Their placements freeze when their season closes, but
strengths, weaknesses and notes stay editable, because what you know about a
player keeps growing after the board is finished.

Switching, rolling over and rolling back all live in one Seasons screen.

---

## 6. Multiple experts

Several analysts keep their own boards. A board has one author; the consensus
board has none, because it is derived rather than written by a person. Analysts
and board names change from one season to the next without stranding anything.

### Who can do what

**Experts** sign in and their work is shared. **Everyone else** is a viewer:
they are not signed in, cannot change anything an expert has published, and can
build and keep their own version locally — their own rankings, their own
play-along draft.

Access is by invitation, tied to an email address. Being invited is what lets
somebody sign in and become an author. Withdrawing the invitation removes
access; the person is still marked as deactivated for the record.

### Boards and ownership

A board is one of three things:

- **Owned** — an author holds it. Only he writes it, and it cannot be taken
  from him.
- **Orphaned** — it has an author but nobody holds it. Every expert can see it;
  nobody can write it. Any expert may claim it.
- **Shared** — it has no author, like consensus. Any expert may write it.

Deactivating an expert releases what he held. Reactivating him takes back
whatever is still unclaimed, but not anything somebody else has claimed since.

Each board is visible to its owner only, to experts, or to everybody — chosen
per board, defaulting to experts for a new personal board.

### Every stage is personal, and one of them is official

Boards were the only stage that belonged to a person. Every stage does.

Each expert — and each viewer — has **their own version of every stage**: their
own free agency shortlist, their own draft, their own undrafted signings, their
own roster. Analysts disagree about who to bring in and what to do with a pick,
and the app exists to show that, so "what I would do" is the normal case rather
than a mode.

Alongside them there is **one official version** of free agency and of the
roster: what the show says, as opposed to what any one analyst would do. Any
expert can set it, from his own version, with a button and a confirmation —
it is a deliberate publication, never a side effect of editing. It records who
set it and when, because it overwrites what somebody else may have published.

Anybody can **replace their own version with the official one** at any time.
That is an explicit act too, and it is the only thing that overwrites personal
work.

### The lead drafter

A live draft has exactly one writer. One expert **claims the lead** when it is
unclaimed, and **releases** it whenever he likes; while he holds it, his picks
are the ones that reach the database. Everyone else either **follows** — the
lead's picks arriving on their screen as they are made — or **works
independently** on their own draft, and can switch between the two.

Nobody else's draft or undrafted signings are shared at all. They stay on the
machine they were made on. There is little to gain from publishing five
analysts' hypothetical drafts, and a great deal of traffic in doing it.

Releasing the lead leaves the picks where they are. The role owns the live
draft, not the history: whoever claims it next continues from what is there.

### Taking the official version, without losing your own

Three things can be done with the official free agency or roster, and none of
them happens on its own. Official changing does not touch anybody's version.

- **Take the official version.** Its placements replace yours. Anybody you had
  who is not in it goes to the **cut panel** — never simply gone. That is the
  whole difference between adopting a state and losing an afternoon's work, and
  it means you can see at a glance who you have just lost and put them back.
- **Fill the gaps from it.** Anybody official has for a position you have left
  empty comes in; nothing you have placed is touched. Safe to run again
  whenever official moves.
- **See that it has moved.** Official records who set it and when, so a version
  that has fallen behind says so rather than looking current.

Somebody with no version of their own sees the official one, read-only. The
moment he changes anything, that becomes his own version, forked from what he
was looking at — nobody has to decide where to start before starting.

### Following a draft, or not

**Everybody follows by default** — experts who are not the lead, and viewers
alike. A draft in progress is the thing the show is about, so watching it happen
is what the app does unless somebody says otherwise.

**Working on your own is a decision**, made deliberately. From then on your
picks stay on your machine, and you stop receiving player updates while you do
it — so the lead's picks cannot appear on players you have not picked yourself.
It is the arrangement a viewer building a private mock already has, and it costs
you seeing other corrections to players until you stop.

Your own draft starts from wherever the one you were following had got to, so
choosing to go your own way at pick 40 does not mean starting at pick 1.

Switching between the two loses nothing either way. The lead's draft and your
own are separate records — his is shared, yours never leaves your machine — so
following again shows his, and going back to your own shows yours, exactly as
you left it.

### Undoing a draft

Only the lead undoes a pick on the live draft, and only the **most recent** one
— again and again, to walk a draft backwards. A pick is never left vacant in
the middle, and pick numbers are never renumbered: they are recorded facts, not
a sequence to be rearranged.

Correcting a pick made much earlier is a **swap**: the same pick, a different
player. Nobody should have to undo twenty good picks to fix one.

A whole draft can be reset, which clears the pick from every player it was
recorded on. It says how many that is before doing it.

A player already carried into somebody's roster stays there when his pick is
undone. The roster is its own work, not a view of the draft, and putting him in
the cut panel is a decision rather than a consequence.

### What carries forward

A personal roster is built from **that person's own draft**, not from the
official one — his picks are what he would do, so they are what his roster
starts from. Adopting the official version is how somebody chooses otherwise,
at whichever stage he wants it.

A personal roster is visible to its owner only, to experts, or to everybody,
chosen the same way a board is and defaulting the same way.

### Working together

What an expert changes reaches everybody else's screen without anyone
reloading. Boards show that they are loading rather than filling in silently.

Written remarks are the exception: they do not stream live, but opening a
player's card shows what is current, without re-fetching what has not changed.

---

## 7. Data in and out

Everything goes in and out as CSV that opens in Excel or Google Sheets, so a
board can be built in a spreadsheet and dropped in.

Remarks travel inside the player's row, introduced by `Remarks:` and marked
with `+`, `−` and `•` for strengths, weaknesses and notes.

Exports of the depth chart have no gaps inside a section. A whole session can
be exported and restored as one file.

An import by an expert is a **proposal**: it is reviewed and confirmed before
anything is written. A file being imported is taken as correct within itself.

---

## 8. Positions

What a player is and where he can stand are different questions.

EDGE also plays outside linebacker in a 3-4; defensive line also plays nose
tackle; linebacker covers its own inside, outside, left and right variants; tight
end and fullback interchange. Linebacker and defensive tackle do not.

This governs placement only. When it suggests that two entries are the same
player, an expert confirms that through the normal flow — it never happens on
its own.

---

## 9. Everywhere

- Works on a phone as well as a computer, down to a narrow screen.
- Any view can be linked to and comes back as it was.
- Work survives closing the browser and restarting the machine.
- A failed save is visible, never silent, and the work is not lost.
- A Help button explains what the app can do.
- Undo is global.

---

## 10. Not part of it

No contracts. No measurements. No mock-draft simulation. No live feed from a
third party in public use. No consensus-versus-personal comparison view.

---

## 11. Left open

Two decisions were deferred rather than made:

- What happens when an expert changes a board a viewer has already altered in
  his own copy.
- Whether written evaluations should attach to the author rather than the
  board — stated as the intended direction, not yet settled as built.
