# DraftBoard — what it is meant to be

What this app is for and how it is supposed to behave, reconstructed from the
full decision history rather than from the code. Where the code disagrees with
this document, the code is wrong until somebody decides otherwise.

`CLAUDE.md` describes what exists. This describes what is intended.

---

## 1. Product and audience

A **broadcast companion** for RGR Football — Ryan Tracy and Daniel Hamrs. They
work a draft board live on stream; viewers watch and play along.

The app's owner is not the analyst. The product succeeds only when **they** run
their real boards in it on air, because that is the pitch: better presentation
for them, better tooling for them.

Everything follows from that:

- Stalling or blanking mid-broadcast is the worst failure available.
- Expert-facing polish outranks general cleanliness.
- The guiding question for any piece of work is whether it helps them put on a
  better show.

---

## 2. The five stages

Free Agency → Scouting → Draft → UDFA → Roster, each feeding the next where
possible.

**Free Agency** is not a signings tracker or a budget tool. It is a
needs-and-candidates snapshot: who might fill a hole. Seeded from last season's
end-of-year roster, because free agency is what happens to that roster.

**Scouting** *builds* the board from the ground up. It is deliberately not a
compare-my-list-against-consensus view. Players are grouped by position, school
or round, filterable — including "evaluated by someone else but not by me".

**Draft** is the live board: position columns by round/tier rows. Normal view
hides taken players and collapses a tier once it is empty — a tier, never a
single player. Focus view shows everything.

**UDFA** is the same board shape after the draft, gated until the draft is
done. A player who went undrafted is still available here.

**Roster** is the 53 plus practice squad, IR and cuts. It seeds additively from
free-agency candidates, your own draft picks and UDFA signings — filling empty
slots, never overwriting a hand edit, safe to run repeatedly. An arrival the
chart has no row for goes to cuts rather than nowhere.

---

## 3. Data model

Three kinds of thing. Conflating them has caused repeated bugs.

**Facts** are true whoever is looking and live once, on the player record:
name, position, school, athletic matrix scores, draft year, round and pick,
team, previous team, whether he went undrafted. No measurements. No contracts.

**Opinions** are per board: tier, order within tier, tag (like, avoid, monitor,
injury).

**Evaluations** are per **person**, stamped with a season: strengths,
weaknesses, notes. They belong to the author rather than the board, because
they are a person's opinion. They accrue across years, and reaching back into
past scouting is the point of keeping old boards at all.

Rules that hold throughout:

- A player is an **id**. Names resolve identity at ingestion and nowhere else;
  ids are used for every normal operation.
- Identity is name, position and school **together**. Any one differing makes a
  different person — two players really do share a name in one class.
- Only tier and order-within-tier are stored. Total and position rank are
  **derived**, so they cannot contradict the board or each other.
- A rank is a position in an ordering. Typing one **moves** a player; it never
  assigns a duplicate.
- An unranked player has **no rank**, not the worst one. `???`, not #328.
- Every board carries every player. Someone one analyst ranked and another did
  not is *unranked* on the second board, not absent from it, or there is
  nowhere to disagree.
- Order within a tier is a float, so one move writes one number on one player.
- Opaque ids, short. No composite keys. A document's key is never repeated
  inside its body.

---

## 4. Boards, authors, seasons

- A **board** belongs to one season and usually one author. Its label renames
  freely; its slug is stable so existing links survive.
- **Consensus has no author.** It is derived rather than written by a person,
  and inventing somebody to own it would make "who said this" a lie.
- An **author is a person** and persists across seasons. Experts and board
  names change from year to year.
- A season makes a board an **artifact**. An archived season freezes
  placements; evaluations stay editable, because what you know about a player
  keeps growing after the board that ranked him is finished.
- Rolling over gives each author a fresh, empty board — a new draft class is
  entirely new people, and carrying placements forward would assert judgements
  nobody made.
- Rolling back scraps the current season, after a warning.
- How many picks each round holds is **stated by an expert**, never derived
  from a pick number. Compensatory picks make the arithmetic wrong.

---

## 5. Identity and access

Two classes of user:

- **Experts** sign in and write to the shared store.
- **Everyone else** is anonymous, receives an identity, and may build their own
  play-along version on top of what they can see — with no write access to
  shared data whatsoever.

Mechanics:

- An `email2author` entry is the access mechanism. It means: you may sign in,
  create your own author record, and read expert material. Deleting it is
  deactivation. A `deactivated` flag exists but is informational only.
- An author's key is the auth uid, so "is this me" is answered from the token
  without a lookup.
- Nobody may create an author in another person's name, or invite in another
  person's name.
- A board is **owned**, **orphaned** (has an author, unclaimed) or **shared**
  (no author). Orphaned boards are readable by every expert and writable by
  none — except the single act of claiming one. Shared boards are writable by
  any expert. An owned board cannot be claimed away from its owner.
- Deactivation orphans what that person held. Reactivation reclaims what is
  still orphaned, but not what somebody else has since claimed.
- Visibility per board: private, expert, public. A new personal board defaults
  to expert.
- **Access control is enforced by the server.** The client is a public static
  bundle; nothing it decides is binding.

---

## 6. What syncs, and what deliberately does not

- Everything an expert changes during a broadcast should reach other devices
  without a reload. That is the entire premise of the shared version.
- **Remarks do not live-sync.** They need an efficient way to be current when a
  card is opened, without paying a read per open when nothing has changed.
- Board loading shows an indicator rather than holding a subscription.
- A player card shows **all** evaluations from all authors, not one board's.

---

## 7. Storage and scale

- Per-user browser storage is bounded and does run out — roughly one scouted
  season per megabyte against a 5MB cap.
- With a backend: keep about four seasons locally, load more as needed, and
  when usage crosses the threshold drop the oldest — pruning players that no
  surviving roster, free-agency board or draft class references.
- Without a backend: offer an export before anything is scrapped.
- Reads are **metered**, and the daily ceiling has been reached in practice.
- The read/write ratio is extreme: potentially tens of thousands of viewers
  against roughly ten writers. That asymmetry, not the feature set, is what
  shapes the shared design.

---

## 8. Backends

**One codebase over interchangeable storage backends** — browser-local, a
hosted document store, and a self-hosted database in a container — selected by
configuration.

The app must remain fully functional with **no backend at all**. That is a
supported target, not a legacy path.

- Reads are synchronous from memory, because the board re-ranks hundreds of
  players on a keystroke and cannot await anything.
- Writes are asynchronous.
- Against a remote store reads become fallible, and the absence of a
  synchronous read is what forces callers to await properly rather than
  silently reading nothing.
- Unsaved work must never be lost — and must never be shown as saved when it
  is not.

---

## 9. Data in and out

- Shipped files create **initial state only**. After that, storage is the
  truth.
- The shared store must be inspectable, repairable and seedable **from outside
  the app**.
- Everything round-trips as CSV that a non-technical person can build in a
  spreadsheet.
- An expert's import is a **proposal**: reviewed and confirmed before anything
  is written.
- A seed file is truth within itself — no merging inside a single file.
- External feeds are proof-of-concept only and never for public use. The
  adapter shape stays; name matching against them becomes a one-time
  translation table rather than a live operation.

---

## 10. Position handling

Placement is not identity.

EDGE plays OLB in a 3-4. DL plays NT. LB covers its own variants. TE and FB
interchange. LB cannot play DT.

Compatibility governs where a player may **stand**, never who he **is**. A
merge proposed on that basis is confirmed by an expert through an existing
flow, never applied silently.

---

## 11. Explicit non-goals

No contracts. No measurements. No mock-draft simulation. No production live
feed. No consensus-versus-personal comparison view.

---

## 12. Unresolved

- **Reconciliation.** When an expert changes a board a viewer has already
  modified locally, what should happen. Parked deliberately; never answered.
  The current local-wins behaviour is a placeholder, not a decision.
- **Evaluations belonging to the author rather than the board.** Decided, not
  built.
- **The viewer proxy.** Evaluated, not built.
