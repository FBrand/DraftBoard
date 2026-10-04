# DraftBoard — rebuild plan

Second draft. The first was evaluated in `PLAN-EVALUATION-2026-09-28.md` and
found sound in three places and wrong in most of the rest; this is re-derived
from that evaluation rather than patched.

Measured against `SPEC.md` (requirements, fixed) and `ARCHITECTURE.md`
(proposal, revisable). Sized for ten experts and five seasons.

---

## Where this stands — 2026-09-30

48 commits, `35a7d89..HEAD` on `firebase`. Nothing pushed. An independent audit
of the work is in `AUDIT-2026-09-30.md`; the findings it raised that are closed
are named below, and the ones that are not are named too.

| Phase | State |
|---|---|
| 1 — make failure observable | **Done.** Three write outcomes (`stored / not yet / never`), refused work held and surfaced, never merged into a read. The audit calls this the best work in the batch. |
| 2 — the seam and the precedence model | **Done.** `overlayAdapter.js` is deleted — the repository's ADAPTER is the layered store (`storeAdapter.js`), so the merge happens once, in named layers, for every collection. Audit R8 closed. |
| 3 — identity, voice, and the seeder | **Done.** A remark is a person's opinion; `ownsVoice` is a token comparison; seeding has left the app entirely (see below). |
| 4 — scope, routing, and the play-along | **Done.** Every stage is per person, free agency and the roster have an official version, the live draft has one writer. |
| 5 — stored shape and the local budget | **Mostly done.** Stable remark ids, the board marker as a field update, prospects as records, no blobs, the budget measured. Eviction is specified and not enforced. |
| 6 — read and write budgets | **Started.** Reads counted and reported; the write budget is no longer the risk (one writer). Deltas and the relay: not built. |
| 7 — permission topology | **Not started.** |

### Seeding has left the app

The item that took three attempts, because the first two were gates rather than
departures. It is structural now: **no file in `src/` contains seeding logic.**

The seeder runs at build time and is not shipped. It uploads to Firestore for the
shared project and, with `--snapshot`, writes the same 1777 documents to a file
for a local build; `data/hydrate.js` copies that into an empty store before
anything renders, and refuses a store that is shared or holds anything at all.
`public/` carries no data file — they live in `seed-data/`, which is not
deployed, so an app that decides who a player is from a text file it ships is
impossible rather than merely unused.

Measured on a cold boot: 22 writes, all hydration; only `picks.txt` and
`columns.txt` fetched, both configuration; all five stages rendering from the
store.

`scripts/snapshot-fingerprint.mjs` compares two snapshots by what must not change
when logic moves — it caught a two-document regression in a 161 KB artifact, in a
field nothing renders, that no test or screen would have shown.

### What the audit raised and is still open

- **R2, R8 — the overlay and the two seams.** The overlay now carries pick facts
  by design, with no divergence marker and no expert-safe way to discard; and the
  newer seam cannot express a private write, so both exist at once. This is the
  seam migration, not a fix.
- **R13 in part — a scrapped season.** A Firestore client cannot list
  subcollections, so with scope as a path level nothing in the app can discover
  which scopes exist. Needs an index document or server-side deletion.
- **Phase 5's eviction**, Phase 6's **deltas and relay**, all of **Phase 7**.
- **One unexplained test failure**, recorded in `BUGS.md`: a scouting reorder does
  not survive a reload. The stored data is correct, so it is rank recomputation
  after a midpoint insertion — `boardRanking`, which `CLAUDE.md` flags as the
  part most easily broken by a well-meaning change.

### Two things worth carrying forward about verification

Both were found by instrumenting rather than reasoning, and neither was visible
to 751 passing unit tests:

- A `const` named in its own callback's dependency array — a temporal dead zone —
  threw on first render and the app displayed **nothing at all**. No unit test
  renders a component.
- The app rewrote 30 player documents on every boot, reconciling a field the
  seeder had not recorded. The document *count* was identical, which is what I
  had been checking. Writes, not totals.

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

### What scope actually is, decided 2026-09-29

The original plan had scope as a two-valued thing — *shared* or *mine* — which
was enough to stop silent shadowing and not enough to describe the app. Four
of the five stages had no owner at all: one draft, one roster, one free agency
per season, writable by any expert, last write wins, pushed live to everybody.
Only boards were personal.

The model, settled with the user and now written into `SPEC.md` §6:

- **Every stage is per person.** Each expert and each viewer has his own free
  agency, draft, UDFA and roster. "What I would do" is the normal case.
- **Free agency and the roster also have ONE official version.** Any expert may
  set it from his own, behind a button and a confirmation, and the write
  records who set it and when — it overwrites somebody else's publication and
  an unattributed overwrite is unanswerable afterwards.
- **Anybody may replace his own version with the official one.** Explicit, and
  the only thing that overwrites personal work.
- **A personal roster is built from that person's own draft**, not the official
  one. Adoption is how somebody chooses otherwise, per stage.
- **Personal drafts and UDFA signings are never shared.** They stay local.
- **Except the lead drafter's.** Exactly one expert holds the lead — claimed
  when unclaimed, released at will — and while he holds it his picks are what
  reaches the database. Everybody else follows him live or works independently
  and may switch. Releasing leaves the picks; the role owns the live draft, not
  the history.
- **A personal roster carries a visibility** — owner, experts, everybody — the
  same three states a board has, so there is one model rather than two.

Two consequences worth naming before building.

**The write budget stops being a problem.** Per-pick writes were the dangerous
shape, and exactly one person now makes them: one document plus roughly three
hundred pick writes for a whole draft, against a ceiling of twenty thousand a
day. What was the riskiest part of the design is now the cheapest.

**The read budget is where the pressure moves.** Every follower is a live
subscription to the same document, against fifty thousand reads a day. That is
precisely the population a read relay serves, and the lead role makes the seam
clean: one subscriber, fanning out. It does not commit us to a relay; it makes
the place one would go obvious. See Phase 6.

### How the personal and the official meet, decided 2026-09-29

**Nothing merges automatically.** Two depth charts cannot be reconciled by
rule: one analyst having Worthy at WR2 where official has Rice is a
disagreement, not a conflict, and any automatic resolution has the app
asserting an opinion nobody holds.

So three explicit actions, and the first is the one that needs care:

- **Take official** replaces your placements — and everybody you had who is
  not in official goes to the **cut panel**. `rosterState` already does exactly
  this when a position row is deleted (it pushes the displaced occupants onto
  `cuts`), and `DepthChartGrid` already renders that panel for Roster and Free
  Agency both, so no new mechanism is needed. Plain replacement, with players
  disappearing, is the one version of this that must not ship.
- **Fill gaps** is the existing `syncFromStages`: additive, never overwrites an
  occupied slot, never removes anything, safe to re-run. Re-pointed at official.
- **Divergence is shown**, using the publication stamp.

**Copy-on-write for a first version.** Somebody with no version sees official
read-only; the first edit forks one from what he was looking at, recording which
official stamp it forked from. That field costs nothing now and is the only
thing that would make a real three-way merge possible later — not built, but
not foreclosed.

### Not following means not receiving, decided 2026-09-29

A pick is a fact on the shared player record, so a non-follower receives the
lead's picks **by construction** — same collection, same subscription. His
player cards would read "KC, pick 12" for a mock he is not watching.

The answer is not to move where a pick lives. It is the arrangement a viewer
already has: an expert working independently keeps his picks in his **local
overlay** and **stops receiving player updates** for the duration. Local wins
on read, so a player he has picked shows his own pick regardless; unsubscribing
is what stops the lead's picks leaking onto the players he has not. Following
is the same thing reversed — subscribe again, and his own local pick facts give
way.

**Following is the default**, for experts and viewers both; working
independently is a deliberate choice. Which means the expensive path — an extra
private copy of pick facts, and a client deaf to player updates — is the one
somebody opts into, not the one everybody lands in by accident.

**Switching is a view, not a migration.** The lead's draft is a shared document
and a personal draft is local-only, so they are different records and neither
write touches the other. Going independent forks from wherever the followed
draft had reached; going back to following writes nothing at all. Nothing has to
be merged or discarded in either direction, which is the one part of this whole
model that costs nothing to build.

The cost, stated: while independent he does not see other corrections to
players — a rename, a school, a matrix score. It is bounded by the session, and
the alternative was restructuring where a pick is stored, which `SPEC.md` §3
settles and the seed data depends on.

### Undo and reset, decided 2026-09-29

- Only the **lead** undoes a pick on the live draft.
- Undo takes the **most recent** pick, repeatedly. No vacated middle picks, and
  no renumbering — `pickNumber` is not arithmetic-safe (the literal `UDFA`, see
  `draftPhase.js`) and renumbering would rewrite two hundred records to move
  numbers that are recorded facts.
- Correcting an older pick is a **swap** at the same pick number.
- Reset already exists and is sound: `draftStore.removeDraft()` nulls the four
  draft facts across every drafted player in one batched write and removes the
  draft document. What it must gain is a count before it runs, and it must not
  reload the page under a lead who is on air.
- Undo does **not** retract downstream work. A player already synced into a
  roster stays there; moving him to the cut panel is a decision. Documented
  rather than automated, by explicit instruction.

What is NOT being built: a persistent undo stack. A pick is facts on a player,
so unpicking is fully defined without history — which is also what lets a new
lead undo a pick he did not make, where a stack would have died with the
previous lead's browser tab. `useDraftState.undoAction` is one step deep and
lives in React state; repeated unpick replaces it rather than extending it.

**The plumbing is small; the rules are not.** `draftStore.draftScope(seasonId)`
and `depthChartStore.rowsPath(stage, seasonId)` are already the single seams
every read and write passes through, so widening scope from *season* to
*season + whose* is those two functions and their paths. The lead claim is the
one genuinely new rules shape, and it is the one the boards already use:
`o: null -> self`, released back to null.

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
expert's version. Two experts hold personal rosters that do not touch each
other; one publishes his as official and the other's is unchanged until he
adopts it; the official roster names who set it. One expert claims the lead,
his picks reach the database, a second expert's picks do not, and a follower
sees the lead's picks without reloading.

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

> **Measured 2026-09-30, and it removes an item from this phase.**
> 
> *"The registry is read by reference — the players a board names — not
> wholesale"* does not work, in two stages.
> 
> First, the registry is not READ. `openRegistry` WATCHES it (`readyVia`),
> because a pick is a fact on a player and the live draft follows the
> collection. Firestore bills a listener's initial snapshot per document, so
> fetching 328 records by id removes nothing — the listener is the cost. The
> version of the idea that survives is a listener scoped by a query, which
> needs a field on the player to filter on. That field is built (`inPools`,
> stamped by `seed/stampPools.js`): 328 of 720 players marked.
> 
> Then the measurement, against the shipped season: **the saving is zero.**
> 
> | who the season needs | documents |
> |---|---|
> | players on a board (the pool) | 328 |
> | roster slots naming somebody the boards do not | +81 |
> | players the draft recorded a pick on | 626 |
> | **union** | **720 — the whole registry** |
> 
> A completed draft puts a fact on 626 player records, and the roster names 91
> more. The season genuinely touches every record, so there is nothing to scope
> away. The 720 reads are not waste; they are the data.
> 
> What this leaves for the read budget, in order of what is actually available:
> 
> - **The relay.** Unchanged and now the main lever: one subscriber for the
>   whole audience, against 720 per client today.
> - **A durable delta**, with the documents kept alongside the point (see the
>   note on the watermark in Phase 4's commit history). A warm reload then
>   costs what changed, not 720.
> - **Not** reading the registry by reference. Struck.
> 
> The `inPools` marker stays: it costs 6 KB, it is correct about what it says,
> and a scoped listener is still the right shape for a season that does NOT
> hold a completed draft — which is every season before its draft happens.

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
