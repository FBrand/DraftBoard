# Evaluation of the rebuild plan

2026-09-28. Same independent reviewer as `AUDIT-2026-09-28.md` and
`FOUNDATIONS-2026-09-28.md`, resumed with its context. Asked to evaluate
`REBUILD-PLAN.md` adversarially: does it fix what was found, is the sequence
survivable, does it hold at scale, what is missing, what is wrong in its own
terms.

**Verdict: worth executing with named changes.**

Reproduced as delivered, with one correction from the user noted at the end.

---

## 1. The inversion in §1 is wrong, and it is wrong in the way that matters

§1 argues the app is "single-user with multi-user apparatus bolted on", and
that this is why eleven of fourteen rotten foundations originate in the
local-only branch.

That is not why. The finding was that `pastel-lantern` **already contained**
the apparatus — `withPending`, the retry queue, `follow`/`startWatching`/
`isLive`, `adapter.watch`, `readFailed`, `ownerId`, an expert/viewer split —
and that **none of it had ever executed**, because no adapter there provides
`watch` and nothing there can refuse a write. The eleven are rotten *because
they were designed for the hard case in the abstract, with no way to verify
any of them*. The easy case was never nominally primary; it was the only case
that ran.

So the inversion treats a symptom as the cause and prescribes more of what
produced the disease: design for a case you cannot yet exercise. §10 addresses
the real cause, and §1 does not reference it.

Three further defects, each load-bearing:

**Local-only is not the degenerate case.** §1 defines it as "nothing is refused
and nothing is metered". Both clauses are false, and §8 says so: the local
build "must hold what it keeps and it will run out". A quota is a meter; a
quota-exhausted write is refused. The local case has one relaxed axis (no
rules) and **two tightened axes the shared case lacks**: a hard cap and no
recovery from loss. A model that derives it by relaxation under-serves exactly
the axis §8 calls a hard wall — and §8 then bolts eviction back on as step 9
of 9.

**"There is no overlay adapter; every backend has the same shape."** Then §5:
"The private scope is opt-in per collection… never covers global facts." That
policy has to live somewhere. Below the seam, the local backend implements
scoping it has no use for and the shapes differ. Above it, callers branch on
scope — A1's duck-typing relocated, not removed.

**"'The client bootstraps the store from shipped files' stops being
expressible."** Then §6: "The local-only build still bootstraps from the
shipped files." It remains expressible; the condition is renamed. And §6's
"Local and deployed builds run the same code" contradicts its own previous
bullet four lines earlier.

What is genuinely right in §1 is one thing, and it is not an inversion: a
viewer's private work should be its own scope in the same model rather than a
layer smeared over someone else's data. That is A11's fix, it is correct, and
§5 states it well. It does not require reversing which case is primary.

---

## 2. Coverage against the foundations map

| | Claimed | Actual |
|---|---|---|
| A1 contract | §2 | **Partial.** Declared capabilities is right. Never reconciles "reads stay synchronous" with a remote backend that has no `loadSync`. |
| A2 whole-collection seam | §2 | **Addressed.** The changed/removed/watermark answer is the strongest technical item in the plan. Misses rule-evaluation reads. |
| A3+A4 | §3 | **Amplifier fixed, entanglement not.** "A refused write is not a layer" is the most valuable sentence in the document. But the entanglement was *optimistic-local-first reads are why the cache is the read path*, and §3 keeps both. Three layers plus an excluded state is more state to keep consistent, not less. |
| A5 registry ids | — | Sound, kept, unnamed. |
| A6 name matching | §7 | **Half.** "Matching once, at import" is right, but §6 keeps the local build bootstrapping from CSVs that carry no ids. Either the files carry ids or boot still matches. Contradiction left standing. |
| A7 author == uid | §4 | Sound, kept. |
| A8 placeholder authors | §4 | **Wrong fix; reopens a closed hole.** See below. |
| A9 `ownerIdFor` | §4 | **Fixed, completely.** Best-targeted item in the plan. |
| A10 `writesRemote` | §5 | **Fixed.** |
| A11 the overlay | §5 | **Partial.** Leaves the tombstone-as-document problem, leaves `overlay.clear` deleting a shared collection, leaves reconciliation *granularity* undefined — which is the parked decision. |
| A12 subject model | §5 | **Claimed, not fixed.** Nothing widens `editRefusal({ownerId, kind})`, so an orphaned board still opens editable while the rules refuse every write. |
| A13 flat permissions | §9 | **Addressed.** |
| A14–A16, A19 | — | Sound, kept, unnamed. |
| A17 blobs | §7 | **Addressed.** |
| A17 pick as player fact | §7 | **Overreach; may contradict SPEC §3.** See below. |
| A18 board doc as marker | §7 | **Claimed, not addressed at all.** |
| A20 remark handle | §7 | **Addressed.** |
| A21 client seeding | §6 | **Half.** The boot/auth race is not mentioned, and it bears on §5: a write issued before auth resolves does not know its scope. |
| A22 lifecycle | — | Covered by accident, never named. |
| A23 eviction | §8 | Addressed in words, mis-sized in arithmetic. |
| A24 test axis | §10 | **Addressed, correctly placed first.** "Tests must run against the data the app actually creates" is the sharpest observation in the document. |

### A18 — claimed fixed, not addressed

§7's heading claims A18. None of its five bullets concern it. §2's watermark is
a *reader-side* concept; `u` is a *writer-side* marker stamped into a shared
parent document. Different mechanisms. Nothing says the board document stops
being rewritten whole from cache — nor does the plan touch the general form,
`write()` assembling every record as a whole document from cache, which is what
makes a stale `o` refuse an entire 328-entry batch.

### A8 — the fix reopens a hole the project closed

§4: boards start "author-less — that is, shared — until a real person claims
one." Two errors.

*Author-less means shared*, and shared means **any expert may write it**
(`ownsBoardData`: `b.o == uid || b.a == null`). SPEC §6's **orphaned** state —
has an author, nobody holds it, nobody may write it — is a different thing, and
the rules suite has ~8 tests distinguishing them. The plan conflates the two in
the sentence explaining the fix.

*"Claiming sets both the author and the owner"* requires removing the board
update rule's authorship freeze (`firestore.rules:479`), added by commit
`e447f7c` — "Freeze board authorship and an author's own address, closing two
capture holes." The plan proposes reopening it without saying so, and without
stating the one-shot constraint that would replace the protection.

### A17's second half — overreach

The rot found was narrower: the *play-along* draft writes into shared truth,
which §5 already fixes. Moving picks into their own collection reverses a
consolidation that removed a real duplicate (BUGS.md line 187: registry knew
295 outcomes, picks held 631, 210KB of a 745KB budget). And SPEC §3 — not open
for renegotiation — lists the draft outcome as a fact about the player. Either
the player keeps those fields and the duplicate returns, or SPEC §3 is
contradicted. Resolved by fiat in one bullet, in the direction with a recorded
failure behind it.

---

## 3. The sequence does not survive its own gate

**"The suites pass" is not currently a gate.** `tests/fast/sharedBackend.spec.js`
runs under `npm test` and its `beforeAll` **throws** when the emulator is down.
It also requires the emulator to have been hand-seeded. Meanwhile
`playwright.fast.config.js:38` builds with plain `npm run build`, and Vite loads
`.env.local`, where `VITE_BACKEND=firebase` with no emulator — so the browser
suite builds an app pointed at the **live** project. `npm test` today either
fails on a missing emulator or spends live read quota. The plan hangs nine
gates on it.

**Step 2 is a slice of step 3, and alone recreates a closed bug.** "Refused ≠
pending" cannot be done without touching the layer model — `discardPending`'s
own comment explains that removing refused values means invalidating
collections with live watchers, which `stopWatching` does not restore. And the
behaviour it produces — the view reverting on a refused write — is recorded in
BUGS.md as removed on purpose. **This is the entangled-pair-as-two-steps
failure, and it is the plan's own step 2.**

**Step 3 cannot be gated.** It rewrites `repository.js` (955 lines), all four
adapters, and every `ready`/`readyVia`/`follow`/`docs`/`get`/`all`/`query` call
site — every store and every hook. There is no intermediate state where the
seam is delta-shaped, precedence is layered, and the app runs, unless both
interfaces are maintained in parallel. §0 rules out data migration and never
considers interface migration.

**Three dependency inversions:**

- **Step 4 depends on step 6.** Re-keying evaluations under "purge and
  recreate" requires the external seeder, which is step 6. Removing placeholder
  authors changes the seed, which is step 6. Circular.
- **Step 5 depends on step 7 and breaks SPEC in between.** §5 forbids the
  private scope covering global facts; a pick is currently a fact on the global
  player; so when step 5 lands a viewer cannot record a pick and SPEC §6's
  play-along stops working, until step 7.
- **Eviction is last and steps 1–8 make the local position worse.** Step 7
  replaces blobs with per-row documents, increasing local document count and
  key overhead, while eviction is step 9.

So: one gate that means nothing, one step that cannot be gated, one step that
is a slice of the next, three dependency inversions, one mid-sequence SPEC
regression. "Nothing is built on a foundation still marked rotten" is false at
steps 4, 5 and 7.

---

## 4. The arithmetic: one wall postponed, one mis-sized

### Local footprint

| | plan | re-derived |
|---|---|---|
| players | 2,500 | ~3,230 — the shipped registry is already ~730 before 500/season |
| entries | 4,920 | understated — SPEC §3 requires every board to carry every player, so it is boards × 500 × 5, not × 328 |
| remarks | 4,500 | 4,500 **at three experts** |
| bytes | ~5.0 MB | ~5.3 MB |

**The decisive error is the number of experts.** The plan sizes for three.
`auth.js:10` and `firestore.rules:15` both say **about ten**. Remarks are per
player per author, so the remark load is 10/3 × 4.69 MB ≈ **15.6 MB**.

Every mechanism §8 offers is inter-season — "oldest season first", "remarks
archived first". **Eviction by season cannot help a current season that alone
exceeds the cap.**

The plan has an escape it never states: the ten-expert load exists only on the
*shared* build, where §8 says remarks are not resident. A local-only build has
one author and fits. **But that means the table describes the shared build
while the wall binds the local one** — and the plan then issues single
undifferentiated rules ("nothing discarded without an export offered first")
for two cases with opposite semantics: on the shared build the local copy is a
cache and discarding is free; on the local build it is the data.

"Remarks are not resident" is also a cache policy the plan never specifies. An
expert working a board opens hundreds of cards in a session and accumulates
exactly the set said not to be resident. No intra-session eviction is named.

**Verdict on the local wall: mis-sized. The binding constraint is
intra-season; every mechanism offered is inter-season; and the table is aimed
at the build the wall does not bind.**

### Read budget

33.7 loads/day is arithmetically correct. But:

- **Rule evaluations are billed reads and appear nowhere.** `boardVisible()` is
  up to 6 accesses per entries read; an entry write is 3. A 328-entry save is
  ~984 rule reads on top of 328 writes. Measured: ~28 ms per written document
  (300-doc batch, 5.0 s → 13.4 s).
- **There is no write budget at all.** The free tier caps writes at 20,000/day.
  A broadcast is a continuous stream of entry writes, each carrying a
  whole-board rewrite and three rule reads. §8 never mentions writes.
- **"Low thousands of reads a day" assumes a durable watermark**, and nothing
  says it is durable. §3's layers are in-memory. If it does not survive a
  reload, every reload is a cold load — the difference between 33 loads and
  3,000.
- **The relay replaces a read wall with a hosting wall the plan never prices.**
  The app deploys to GitHub Pages; there is no server anywhere in this project.
  The plan requires infrastructure that does not exist and does not mention
  acquiring it.

**Verdict on the read wall: postponed, not cleared** — to a relay that is one
bullet, last in nine steps, dependent on a host that does not exist, and by the
plan's own words "the only arrangement in which the audience exists at all".

---

## 5. Missing entirely

**Read failures and dead listeners.** The largest omission. `loadFailed()` has
one consumer and no UI surface; the "Live updates stopped" message is
constructed with `permanent: false` and its only listener discards it; a
`permission-denied` on a watch deliberately blanks the board. SPEC §6 requires
loading to be visible; `ARCHITECTURE.md` §4 requires it. For a tool whose
stated constraint is that it must never stall or blank on air, a plan that
never mentions read failure is not a plan for this product.

**Viewers cannot read `authors` at all**, so no author name on any board and no
grouping heading on any card, for the whole audience, silently. SPEC §3 and §6
both require it.

**`useDraftState`'s live-sync feedback loop** — `follow(PLAYERS, adopt)`
subscribes to the same `notify` that every local write fires; terminates only
because `writeDraft` happens to diff. §12's "does not touch the views" is where
it hides.

---

## 6. Wrong in the plan's own terms

**"Roughly 7,000 lines of view code are untouched."** Offered as reassurance;
it is the reverse. The rot reaches into the hooks, not the views —
`useDraftState` mints registry records at boot, `usePlayerTags` re-reads 328
documents, `useBoardRankings` seeds on every boot. All change under steps 3, 5,
6, 7.

**§7's fifth bullet is not a change.** "Season is the scope unit" is the
current design, in a section claiming to fix four foundations.

**§10 credits itself for what it is proposing.** "A test that fails when a
write does not reach the store. **This exists now**" — it exists, cannot run in
CI, and breaks `npm test`, which is what the next bullet is about.

**Every gate is internal.** Nine steps gated on "the suites pass", in a
codebase where this audit found a fully-tested dead subsystem, a rules suite
asserting the shipped seed's fatal state is correct, and a 93% claim that is
89%. No external criterion is named anywhere — not a read count measured
against the live project, not a board demonstrably not blanking when a listener
dies.

---

## What it gets right

Three items are correct and not available elsewhere: §2's delta seam with
removals and a watermark (the one thing that genuinely cannot be added later);
§3's "a refused write is not a layer" (the amplifier under every permission
failure); §4's unconditional author-keyed evaluations (fixing the one defect
verified as presently fatal). §10's placement of verification first, and its
seed-shape observation, are also right.

That is a real spine, surrounded by a diagnosis that inverts cause and effect,
three claimed fixes that are not fixes, an overreach that may contradict SPEC,
a sequence wrong at four points, arithmetic aimed at the wrong build, and the
largest requirement in the product as one bullet at position nine with no host.

---

## Verdict

**Worth executing with named changes.** §2, §3 and §4 are sound and should
proceed. §1's inversion must be discarded as the organising idea. §11's
sequence is wrong at four points and must be re-derived. A8, A12 and A18 are
claimed-not-fixed, and A17's pick change is unjustified overreach. §8's sizing
must be redone for ten experts and for the local build specifically. Read
failure visibility and the relay's hosting must enter the plan before any gate
in it means anything.

---

## One correction to the evaluation

§6 challenges "no live data" as "an assertion about somebody else's project
presented as a fact". It is not the plan's assumption — it is the project
owner's stated position: *"not live production, poc. purge and recreate no
problem."* The reviewer had no access to that. The broader point it makes —
that declaring migrations *not needed* lets their absence shape the seam — is
untouched by this and stands.
