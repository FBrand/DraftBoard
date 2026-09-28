# DraftBoard — rebuild plan

Second draft. The first was evaluated in `PLAN-EVALUATION-2026-09-28.md` and
found sound in three places and wrong in most of the rest; this is re-derived
from that evaluation rather than patched.

Measured against `SPEC.md` (requirements, fixed) and `ARCHITECTURE.md`
(proposal, revisable). Sized for ten experts and five seasons.

---

## 0. Scope

**Rebuilt:** the storage seam, the read and precedence model, identity and
voice, write routing, seeding, the shape of stored data, the permission
topology, the verification axis, and both budgets.

**Kept:** the product surface — five stages, views, ranking model, grids,
drag-and-drop, CSV formats. `SPEC.md` is not open for renegotiation.

**Not kept as a reassurance:** the claim that the views are untouched. The rot
reaches into the *hooks* — `useDraftState` mints registry records at boot,
`usePlayerTags` re-reads a whole board to find what changed, `useBoardRankings`
seeds on every boot. Every one of those changes here. The views below them do
not.

**Migrations:** not built, because there is no data worth keeping. But the seam
in §2 carries a document version from the start, because "not needed" is what
let the current shapes calcify, and this is the second rebuild.

---

## 1. The organising idea

The first draft said the app was single-user with multi-user machinery bolted
on, and proposed inverting which case is primary. That was wrong: the machinery
was already there — the retry queue, the overlay merge, `follow`/`watch`,
`ownerId`, the expert/viewer split — and **none of it had ever executed**,
because nothing on that branch could push a change or refuse a write.

The rot did not come from the easy case being primary. It came from building
for a hard case nobody could exercise, and being unable to tell.

So the organising rule is not an inversion. It is:

> **Nothing is designed for a case we cannot exercise. A mechanism that cannot
> be observed failing does not get built.**

Which has a consequence that orders everything below: the ability to *see*
comes first, and every phase is gated on an observation, not on a green suite.
This codebase currently contains a fully-tested subsystem with no callers, a
rules suite asserting that a fatal state is correct behaviour, and three
comments describing fixes that do not exist. "The suites pass" is the weakest
available evidence here.

The one genuinely good idea in the first draft's §1 survives on its own terms
and does not need an inversion to justify it: **a viewer's private work is his
own scope in the same model, not a layer smeared over somebody else's data.**

---

## 2. Phase 1 — Make failure observable

Nothing else is trustworthy until this is done, and it is days of work.

**Fix what is broken now.** `npm test` currently throws when the emulator is
down, because a spec that requires it sits in the default browser suite. And
the browser suite builds from `.env.local`, so it runs against the **live**
project. Both are regressions introduced while this audit was in progress.

- The emulator-dependent suite is its own target, skipped rather than throwing
  when the emulator is absent.
- The browser suite builds against the emulator, never the live project.
- The rules suite runs in CI. The security boundary is currently unverified on
  every commit.

**Add the third arm.** The axis is "a function of values" and "needs a
browser"; a shared, fallible, rule-enforced store is a third kind and falls off
both. Composition tests run against the emulator with real identities: an
expert, a viewer, a revoked expert.

**Make the tests use the data the app actually creates.** The rules suite
asserts the correct refusal of exactly the state the shipped seed produces
universally. Seed-shape tests close that.

**The audience cannot read `authors` at all.** `firestore.rules:356` is
`allow read: if isExpert() || authorId == request.auth.uid`, so for every
viewer the collection resolves to `{}` — silently, because a refused read is
indistinguishable from an empty one. The result is no author name on any board
and no grouping heading on any player card, for the whole audience. `SPEC.md`
§3 requires remarks "grouped under the author's name" and §6 requires a board
to have one. This is both a rules defect (§8) and the clearest instance of why
read failure must be visible, which is the rest of this section.

**Surface read failure.** Today a failed read returns `{}` and renders as an
empty board; the "live updates stopped" message is built and then discarded by
its only listener; a permission error on a watch blanks the board deliberately.
For a tool that must never blank on air, this is the observability gap that
matters most.

*Gate:* a test that fails when a write does not reach the store, a test that
fails when a read silently returns nothing, and both running in CI without a
hand-seeded emulator.

---

## 3. Phase 2 — The seam and the precedence model

**Fixes A1, A2, A3+A4.** These are one phase because they are entangled; the
first draft split them and that was the same mistake it was written to avoid.

### The contract

Written down, complete, and **versioned per document**. Capabilities that
genuinely vary — can it push, can it answer synchronously, can it refuse — are
declared by the backend and asked once, not detected by probing for methods.

### Reads are document-granular and change-aware

> *give me what changed since this point, and tell me the new point*

Three parts in the answer: changed documents, **removed** documents recorded as
removals, and the new watermark. A first read passes no point.

**The watermark is durable.** It survives a reload. Without that, every reload
is a cold load and the delta buys nothing for the case that actually
happens — an expert reloading a stuck page mid-broadcast. This is the single
property that separates ~3,000 reads a day from ~30.

### Writes report per change

Each change in a batch reports its own fate: landed, refused, not yet.

### Precedence, named

```
shared    what the store said
mine      this person's own work
unsent    issued, not yet acknowledged
```

One merge, one stated order, and **refused is not a layer** — a rejected write
is a fourth state and is never merged into a read. That sentence is the
amplifier under every permission failure in the audit.

Any caller can ask any layer, and readiness is per layer, so "the store has not
answered" is distinguishable from "the store says nothing". Callers that
*decide* must use the former; callers that *render* use the merge.

### How this lands without a big-bang rewrite

The first draft claimed this step could be gated and it could not — it touches
`repository.js`, four adapters, every store and every hook. So the old and new
interfaces run **in parallel**, and stores move across one at a time. Each
migrated store is a gate: the app runs, that store is delta-capable, the rest
are unchanged. The old interface is deleted when the last store leaves it.

*Gate, per store:* it reads via a delta after its first load, and a composition
test proves a refused write is not displayed as stored.

---

## 4. Phase 3 — Identity, voice, and the seeder

**Fixes A8, A9, A21.** One phase, because the first draft's step 4 depended on
its step 6: re-keying evaluations needs the external seeder, and removing
placeholder authors changes what the seeder writes.

- **Evaluations are keyed by the author's uid, unconditionally.** No fallback
  to a board id. This is `SPEC.md`'s stated direction and it fixes the one
  defect verified as presently fatal.
- **Seeding leaves the client.** Against a shared backend, finding nothing
  means *reporting an unseeded project*, not creating one. The guarantee lives
  in code, not in a build step that deletes files. The local build still
  bootstraps, because there the client *is* the store — and that condition is
  named explicitly rather than implied by which backend is configured.
- **Boot does not race sign-in.** No store-mutating work runs before identity
  is known. A write issued before auth resolves cannot know its scope.

**Orphaned is not shared.** The first draft conflated them; the rules go out of
their way to distinguish them and `SPEC.md` defines both. Author-less means
*any expert may write it* — that is consensus. A personal board nobody holds is
**orphaned**: it has an author and nobody may write it.

So the seed carries personal boards as **orphaned**, and claiming is a
**one-shot transition**, not an unfrozen field: `o` null → your uid, and `a` →
your uid, in one write, permitted only while `o` is null and only to yourself.
The authorship freeze that commit `e447f7c` added stays for every other case;
the capture hole it closed stays closed.

Two details the first draft left unstated. The seeded `a` holds a **marker
that is not a uid and cannot become one** — an orphaned board needs an author
to be orphaned rather than shared, and the marker exists to be replaced on the
first claim. And because the label is display text that claiming does not
change, **the first expert to claim a board labelled "Dan" becomes its author**.
That is a race with no tiebreak. It is not fatal — evaluations no longer route
through `a` — but the claim control names the board it is about, and an
expert who claims the wrong one can release it.

*Gate:* an expert writes a remark on a personal board and it is in the
database — verified by reading it back, not by the screen.

---

## 5. Phase 4 — Scope, routing, and the play-along

**Fixes A10, A11, A12.** Bundled with the play-along because the first draft's
step 5 broke `SPEC.md` for two steps until its step 7.

A write names the **scope it is for**, chosen by the target, not by who is
signed in: *shared* for a board you may write, *mine* for anything you may not.
The store enforces what you may actually do.

- An expert who may not write a board is refused visibly, not silently
  shadowed.
- A demoted or unconfirmed expert cannot accumulate a session that reaches
  nobody.

**The private scope is opt-in per collection and never covers global facts.**
The registry is shared truth; a viewer's copy must not shadow an expert's
correction.

**The play-along therefore gets its own place.** A pick by an expert stays a
fact on the player — `SPEC.md` §3 says so and that is not negotiable, and
moving picks back to their own collection would restore a duplicate that was
deliberately removed. A *viewer's* play-along is a private draft record
instead. Both exist from the moment scope lands; nothing regresses in between.

**The subject model widens.** `editRefusal` currently takes owner and kind, and
cannot express a three-state board plus a visibility — which is why an orphaned
board opens fully editable while every write to it is refused. It takes the
board's actual state.

**Divergence is visible and reversible**, with the granularity stated: per
board, not per document. `SPEC.md` may keep the *default* parked; it cannot
keep parked whether there is a way back.

*Gate:* a viewer runs a full play-along draft; the shared player records are
untouched; his own copy survives a reload; and he can discard it and see the
expert's version.

---

## 6. Phase 5 — The shape of stored data, and the local budget

**Fixes A6, A17, A18, A20, A23.** The local budget belongs here because this
phase *increases* document count, and the first draft left eviction to last
while seven steps made the local position worse.

- **No blobs.** Every stage is per-row or per-entry, as the depth chart already
  is.
- **The board document stops being rewritten whole from cache.** The change
  marker is a field update. The general pattern — assembling a whole record
  from cache on every write, so a stale field is written back and a concurrent
  change is clobbered — goes with it. That pattern is what lets a stale
  ownership field refuse an entire 328-entry batch.
- **A remark has a stable identity**, not an array index.
- **Name matching happens once, at import.** For that to be true of the local
  build too, the shipped files carry ids — otherwise boot still matches, which
  is the contradiction the first draft left standing.

### The local budget, sized properly

Ten experts, not three. Remarks are per player per author, so they dominate:

| | one season | fits in 5 MB |
|---|---|---|
| 3 experts | 1.03 MB | 4.8 seasons |
| **10 experts** | **3.12 MB** | **1.6 seasons** |

**The binding constraint is intra-season, and every inter-season mechanism is
useless against it.** Dropping the oldest season cannot help when one season
does not fit.

The two builds need different answers, and the first draft issued one rule for
both:

**Shared build** — the local copy is a *cache*. Remarks are not resident; they
are fetched when a card opens and only when the marker says they changed. The
working set is bounded and discarding it is free, because it can be re-fetched.
Intra-session eviction is required and must be specified: an expert opens
hundreds of cards in a session and accumulates exactly the set that is supposed
not to be resident.

**Local build** — the local copy is *the data*. One author, so one season is
~0.44 MB and roughly eleven fit. (The first draft said 1.0 MB and four to five,
which was the three-expert figure borrowed from the row above — the same slip
as its predecessor, smaller.) Eviction is real, oldest season first, and
**nothing is discarded without an export taken first**, because here a dropped
season is a lost season.

**But "one author" is an assumption, not a guarantee.** `SPEC.md` §7 has a whole
session exported and restored as one file, and remarks travelling inside CSV
rows — so a local build can import a ten-author season and land in exactly the
volume this paragraph says it never holds. The local budget is therefore driven
by **what was imported**, not by which build is running, and eviction has to
measure rather than assume.

*Gate:* a synthetic ten-expert season is generated and the shared build stays
inside the budget; the local build refuses to lose data without an export.

---

## 7. Phase 6 — The read and write budgets

**Both walls, and there are two, not one.**

### Reads

- Deltas are the normal path (§3), with a durable watermark.
- The registry is read **by reference** — the players a board names — not
  wholesale.
- Remarks are not resident (§6).

**Experts read through the relay too.** This is the change that does most of
the work, and it costs nothing extra: the relay already holds the current state
for viewers. Splitting a cold load by what an anonymous reader may see:

| | serveable by the relay |
|---|---|
| `players`, consensus entries, seasons, board records, draft state | yes |
| expert-visibility boards, `authors` | no — must come from the store |

That moves roughly **80% of an expert's cold read** off the metered store.

**This reverses `ARCHITECTURE.md` §6**, which says "Experts do not use it. They
stay connected directly, because they write." That constraint is overturned
deliberately and the document is updated to match, rather than left contradicted.

Three properties make it safe rather than merely cheap. It is **not a new
layer** — the relay is an alternative provider of `shared`, so the precedence
model is unchanged. **Read-your-own-writes falls out free**, because an
expert's own writes sit in `mine`/`unsent`, above `shared`, so relay lag is
invisible to him. And there is **no new exposure**: the relay listens as an
anonymous reader and can only ever serve what the reader could already see.

### Freshness is about the other expert, not yourself

Read-your-own-writes disposes of self-staleness and nothing else. The case that
matters on air is the opposite one: Dan makes a pick and **Ryan's** screen is
behind by the relay's lag. `SPEC.md` §6 — "What an expert changes reaches
everybody else's screen without anyone reloading" — is about exactly that, and
the precedence order does not touch it.

So a staleness indicator with a manual refresh is **not sufficient**. It lets
Ryan notice he is wrong; it does not make him right. For the collections that
are live during a broadcast — the board being worked, the draft state, and the
players in it — an expert either subscribes directly to the store, or the
relay's push path carries the same guarantee the store's own listener would.
Which of those is chosen is a measurement, and the requirement is not: **no
expert may be silently stale on a live collection.**

Everything else an expert reads — the registry, archived seasons, other boards,
season and board records — has no such requirement and comes from the relay.

### When the relay restarts

Its state is disposable and rebuilt from the store, and on a free container
host restarts are routine: idle eviction, deploys, memory limits. Each restart
costs a cold read of everything it holds (~1,100 documents) against the metered
store, and every client then resynchronises — now including experts.

So the economics invert at the worst moment: **the budget the relay was bought
to protect is spent precisely when the relay fails**, because the stated
fallback has every expert reading directly at exactly that instant. Two things
follow, and both are requirements rather than optimisations: the relay's own
rebuild is a delta against a durable watermark rather than a cold read wherever
the store allows it, and restart frequency is a number that gets measured on
whichever host is chosen before the audience depends on it.

One obligation remains from the original framing: the fallback to direct reads
must be **real and tested**, so a relay outage degrades experts rather than
stopping them.

### The credential stays anonymous

The security property above holds only because the relay reads as an anonymous
viewer. The pressure to give it an expert credential is foreseeable — the
expert-visibility board entries it cannot serve are the largest remaining item
in an expert's cold read. **It must not be given one.** A relay holding expert
credentials and serving an unauthenticated channel is a confused deputy, and
every guarantee in this section collapses at that point.

### Writes — absent from the first draft entirely

The free tier caps writes at 20,000/day as well as reads at 50,000, and a
broadcast is a continuous write stream. Each entry write also costs rule
evaluations, which are billed reads: an entry write is three document accesses,
and reading a board's entries is up to six. Measured, the rules add ~28 ms per
written document — 1.7× the write itself.

So the write path is budgeted explicitly: one write per change (§6 removes the
board-document rewrite that rides along with every entry), and the rule
evaluation count per write is a number that gets measured, not assumed.

### Hosting

The relay needs somewhere to run and this project has no server. A free
container host or an edge worker is the intended answer; the choice is open,
the requirement is not. It is named here rather than left as a bullet at the
end of the sequence, because by the plan's own reasoning it is the only
arrangement in which an audience exists at all.

*Gate:* a real boot measured against the live project, with the read and write
counts published. Not inferred from the code — counted.

---

## 8. Phase 7 — Permission topology

**Fixes A13, and the four stages that have no ownership.**

- **A tier above expert** for irreversible acts: revoking another person,
  rolling a season, scrapping one. Today any invited person can revoke
  everybody, including whoever set the project up, and nothing prevents the
  last invitation being deleted.
- **Ownership on the non-board stages.** Roster, free agency, draft and the
  prospect pool are singular and global with no owner, so two analysts working
  at once overwrite each other with no signal. Whether they are per-author or
  explicitly shared with a conflict signal is a decision to take — the current
  answer is a default nobody chose.
- **Lifecycle operations are atomic or resumable.** Scrapping a season is a
  dozen unsequenced writes that look successful whatever the store did.

---

## 9. Sequence and gates

| | Phase | Gate — an observation, not a green suite |
|---|---|---|
| 1 | Observability (§2) | CI fails when a write does not land, or a read silently returns nothing |
| 2 | Seam + precedence (§3) | per store: reads by delta; a refused write is not displayed as stored |
| 3 | Identity, voice, seeder (§4) | a remark written on a personal board is read back out of the database |
| 4 | Scope, routing, play-along (§5) | a viewer drafts a full class; shared records untouched; he can discard and take the expert's version |
| 5 | Data shape + local budget (§6) | ten-expert synthetic season stays in budget; local build will not lose data without an export |
| 6 | Read/write budgets, relay (§7) | measured counts against the live project, published |
| 7 | Permission topology (§8) | a non-owner cannot revoke; a season lifecycle failure leaves a recoverable state |

Phase 1 is days. Phase 2 is the large one and is gated per store rather than as
a whole. Phases 3–5 are each bounded. Phase 6 is where the product either works
at scale or does not, and it cannot be attempted before phase 2.

**Every gate is external.** No phase is gated on "the suites pass" — this
codebase has a fully-tested dead subsystem, a rules suite asserting a fatal
state is correct, and three comments describing fixes that do not exist. The
suites are necessary and are not evidence.

---

## 10. What this plan does not do

- It does not touch the views, stages, ranking model or CSV formats.
- It does not preserve existing data, but it does version documents from the
  start.
- It does not build the third backend. §3's contract is what makes it possible;
  building it now would be guessing.
- It does not resolve whether the four non-board stages are per-author or
  shared. That is a product decision, named in §8, and it is not mine to take.
