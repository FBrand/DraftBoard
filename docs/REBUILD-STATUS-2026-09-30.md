# The rebuild so far — honest status, 2026-09-30

64 commits, `35a7d89..HEAD`, pushed as `firebase0.2`. Last updated 1 October. Measured against
`SPEC.md` (requirements) and `REBUILD-PLAN.md` (the plan), with an independent
audit of the work in `AUDIT-2026-09-30.md`.

Written to be useful rather than flattering: the mistakes are in here because
three of them cost more than the features did, and two were invisible to a
passing test suite.

---

## 1. What is actually done

### Failure is observable (Phase 1)

A write has three outcomes, not two: **stored / not yet / never**. Refused work
is held, addressable, and shown as refused — never merged into a read, never
silently dropped. Before this, a refused write was merged back into every read,
so somebody saw their own rejected copy of a board indefinitely, across reloads,
while the database held nothing of it. That was the amplifier under every
permission failure in the first audit, and it is closed in both stores.

The independent audit calls this the best work in the batch.

### A remark is a person's opinion (Phase 3)

`ownerIdFor(board)` answered two questions with one value — "whose opinion is
this" and "which board am I looking at" — while `firestore.rules` answered the
first from the token. They agreed only where a board's author equalled the
writer's uid, which the shipped seed guaranteed never happened. So **no expert
could write a strength, weakness or note on any personal board**, and because a
refused write was merged into reads, his note stayed on screen while the database
never held it.

`voiceOf`/`myVoice` split the question; `ownsVoice` collapsed to a token
comparison, taking two billed reads off every remark write. Remarks are grouped
by author everywhere — card, delete-safety check, export — with no board
consulted in either direction. A remark carries its own id (`n`, an integer per
document) instead of its array position, because a positional handle edited the
wrong remark the moment a neighbour was deleted.

### Every stage belongs to a person, or to the show (Phase 4)

There was one roster and one free agency per season, writable by any expert, last
write wins. Now:

    seasons/{s}/charts/{stage}/scopes/{whose}/rows

Reads fall back (mine → official → legacy unscoped); **writes never do**, which
is what stops an edit to the official chart you are being *shown* from becoming
everybody's. Free agency and the roster each have one **official** version that
any expert may publish behind a confirmation, stamped with who did it and when.
Taking official sends anybody it does not carry to the **cut panel** — nobody
disappears.

The live draft has exactly **one writer**: an expert holds the lead (`o` on the
draft document, claimed `null → self`, released back), and only his picks reach
the database. Everybody else follows him, which is the default, or works on a
draft that never leaves his machine — enforced by a `{ mine: true }` flag
threaded through the write path, because a pick is a fact on a *player* and that
collection also carries names and schools an expert should publish. The rules
cannot tell those apart; only the caller can.

### Seeding has left the app (Phase 3's hardest item)

**No file in `src/` contains seeding logic.** This took three attempts: the first
two were gates (`if (repository.isLive()) return`), which keep the logic and add
a condition — and a condition is what gets forgotten.

- The seeder runs at build time and is **not shipped**. It uploads to Firestore
  for the shared project and, with `--snapshot`, writes the same 1777 documents
  to a file for a local build.
- `data/hydrate.js` copies that into an **empty** store before anything renders,
  and refuses a store that is shared or holds any document at all. One rule:
  only ever write into emptiness.
- `public/` carries **no data file**. They live in `seed-data/`, which is not
  deployed — so an app that decides who a player is from a text file it ships is
  impossible rather than merely unused.

Measured on a cold boot: 22 writes, all hydration; only `picks.txt` and
`columns.txt` fetched, both configuration; all five stages rendering from the
store.

### Stored shapes (Phase 5)

No blobs left: prospects became three collections keyed by the identity they are
about, because the old read-modify-write over one array meant two experts adding
a player lost one of them silently. The board's change marker is a **field
update** — it used to reassemble the whole document from cache, writing stale
*ownership* back, which the rules refuse, taking all 328 entries batched with it.

### Rules

The recursive `match /{document=**}` under `seasons/{seasonId}` is gone and every
collection is named. That wildcard already *reached* the new scoped paths — so
`rulesCoverage` stayed green while giving the wrong answer, since any expert
could write any other's chart. **Rules are a permissive union**: a narrower rule
under a broad one reads as a restriction and enforces nothing. The breadth had to
go, and a test now fails if it returns.

Also closed: a revoked lead froze the live draft permanently (measured — all four
escape routes refused, where the identical board state recovers, because
`/boards` has a carve-out the draft was not given); personal charts were
world-readable; and every remark rendered as "Unattributed" to the whole
audience, because the card looked names up in a collection viewers cannot read.
A name is not sensitive and an email is, so they are separated rather than the
restriction relaxed.

### Instruments

- `scripts/snapshot-fingerprint.mjs` — compares two seed snapshots by what must
  not change when logic moves. It caught a two-document regression in a 161 KB
  artifact, in a field nothing renders.
- `utils/storageBudget.js` — measures what is stored, wired into the quota
  failure path.
- Document-level read counting: a cold load costs **1768 document reads**.

---

## 2. What I got wrong

Recorded because the pattern matters more than the individual bugs.

**A temporal dead zone rendered nothing at all.** `privatePick` was declared
below the two callbacks whose dependency arrays name it. `useDraftState` threw on
first render and the app displayed a blank page — while **751 unit tests passed**,
because not one of them renders a component. Found with an unminified build and a
page-error listener, after two wrong guesses about a module cycle.

**Counting documents instead of writes.** The app rewrote 30 player documents on
every boot, reconciling `draftRound` — a field the seeder had not recorded. The
document *count* was identical before and after, which is exactly what I had been
checking. Found by instrumenting `Storage.setItem`.

**A vacuous test, three times in a row.** A test that a private write stays local
asserted a returned `0`, which was also what three unrelated conditions returned.
It passed with the feature deliberately removed. Twice more after that, until it
asserted on something only the feature could cause.

**Claiming something was enforced when it was requested.** I told the user the
lead's exclusivity was "real at the database". The audit measured otherwise:
`setFacts` took no options, so with one expert holding the lead another expert's
pick landed in the shared registry.

**Building the prerequisite before measuring the payoff.** I built the pool
marker for a scoped registry listener, then measured the saving: zero. See §4.

---

## 3. Current status

| | |
|---|---|
| unit | 745 |
| rules | 122 (emulator) |
| browser | 48 pass, 1 skipped, 3 known failures |
| lint | clean |
| snapshot | 1777 documents, fingerprint stable |
| cold boot | 1768 document reads, 22 local writes, no page errors |

The known browser failure is **unexplained** and recorded in `BUGS.md`: a
scouting reorder does not survive a reload. The stored data is correct — the
snapshot carries `withinGroup` in the analysts' file order, verified against the
CSV — so it is about how ranks are recomputed after a midpoint insertion. It
touches `boardRanking`, which `CLAUDE.md` flags as the part most easily broken by
a well-meaning change. **This is the first thing to look at next.**

---

## 4. What is open

### Struck from the plan, with a measurement

**"Read the registry by reference" saves nothing.** The registry is *watched*,
not read — a pick is a fact on a player and the live draft follows the collection
— and a listener bills its initial snapshot per document, so fetching 328 by id
removes nothing. Scoping the *listener* is the surviving idea and the field for
it is built (`inPools`, 328 of 720 marked). But the season needs the union of the
pool (328), roster slots the boards do not name (+81) and every player the draft
recorded a pick on (626) — **720, the entire registry.** Those reads are not
waste, they are the data.

### Structural, and the biggest items left

- **The overlay, and two adapter seams at once** (audit R2, R8). The overlay now
  carries pick facts by design, with no divergence marker and no expert-safe way
  to discard; the newer seam cannot express a private write, so both exist. This
  is the seam migration, not a fix.
- **A scrapped season cannot be completed from a client** (R13). A Firestore
  client cannot list subcollections, so with scope as a path level nothing in the
  app can discover which scopes exist. Needs an index document written with
  `arrayUnion`, or server-side deletion — which would also give `scrapSeason` the
  atomicity it has never had.

### Phase 6, reduced to two levers

- **The relay.** Not started, and now the main one: one subscriber for the whole
  audience against 720 documents per client.
- **A durable delta.** The watermark was persisted without the documents, which
  is the state `forget()` exists to prevent; it is back in memory. Saving those
  reads needs both kept together.

### Phase 5 and 7

- **Eviction** is specified, measured and not enforced.
- **Phase 7** — permission topology, ownership on the non-board stages beyond
  what landed, atomic season lifecycle — not started.

### Smaller, known

- Per-chart visibility (public/private) needs a stored field and a `get()` per
  row; the expert-default is in place as the safe end of that choice.
- `seedBoard` remains in the app because "create board from CSV" is an import,
  not seeding. It wants splitting, not deleting.
- Placeholder authors for Dan and Ryan stay by explicit decision while in PoC.
  They are inert — nobody can ever hold that voice — so they can only hold seed
  data.

---

## 5. Overlay removal — DONE

`src/data/overlayAdapter.js` is deleted and nothing in `src/` refers to it.

The approach that worked is not the one planned. The plan had every collection
migrating onto the layered store one at a time, and that is a rewrite of the
data layer: the remaining callers use 24 distinct repository methods, and
mixing seams produces exactly the two-caches-over-one-backend divergence the
exercise exists to remove — measured, when `boardEntries` crossed and started
reading `boards` through a store that did not own it, silently dropping the
board's change marker.

What the overlay actually did was merge remote and local with local winning,
with tombstones, and route a write to one or the other. The layered store
already does all of that with the layers named. So **the repository's ADAPTER
became the store** (`data/storeAdapter.js`): every caller keeps its API, and the
merge moved from two anonymous halves to `shared` / `mine` / `unsent` with
precedence stated once.

`canWrite` replaces `writesRemote`, and the difference is the point: a write
that may not be published is not refused, it is this person's own work, so it
goes to `mine` and stays there. That is the viewer's play-along, named instead
of implied.

Five collections did cross the seam first — `evaluations`, the three prospect
collections, `stages`, `setup` — and `MIGRATED` became a predicate over paths
on the way, because every candidate embeds an id. Those stay as they are.

Three bugs came out of it, all mine:

- **`ready()` re-read on every call**, and a complete read REPLACES the shared
  layer, so a followed collection lost every snapshot the moment anything asked
  again. Read-once belongs in the adapter, not the store: the store must stay
  re-readable or a delta can never apply onto what is held. The first fix put
  it in the store and broke two watermark tests, which is how I found that out.
- **`watch` did not mark a path as read**, so the first `load()` after a watch
  opened wiped the snapshots. Following a collection is having read it.
- **Neither the memory nor the local adapter honoured `merge`** — both replaced
  the document, which makes the flag a lie one layer below whoever set it.

The five overlay test suites were REPLACED, not dropped:
`tests/unit/storeAdapter.test.js` lists what each asserted and covers the same
properties — a viewer's work over the experts', tombstones, a failed read
answered from his own work, a pushed change that does not clobber, a private
write, a merge, and the deliberate absence of `loadSync`.

### A literal NUL byte, found on the way

`store.js` had contained one since the layered store was written: `key()`
joined a collection and an id with it, and `view()`'s prefix test held the same
byte as a real newline — so it compared `collection\n` against keys using
`collection\0` and **nothing in flight was ever displayed**. A write vanished
from the screen until it landed. Node tolerates a NUL in source, so 769 tests
ran over it; esbuild does not. It also explains a long run of patch attempts
failing on those exact lines with nothing on screen to explain why.

## 6. What overlay removal did not cover

The data layer has one seam now, with named layers. These remain:

- **Phase 7 entirely** — permission topology, ownership on the non-board stages
  beyond what landed, an atomic season lifecycle. Not started.
- **The relay** — one subscriber for the audience against 1768 document reads
  per client. Not started, and needs hosting.
- **A durable delta** — the watermark and its documents kept together, so a warm
  reload costs what changed. The store is ready for it; the backend is not.
- **Eviction** — specified, measured, not enforced.
- **A scrapped season** cannot be completed from a client: Firestore cannot list
  subcollections, so nothing can discover which chart scopes exist. Needs an
  index document or server-side deletion.

### Three browser tests need fixtures that match the seeded data

All three are recorded in `BUGS.md` with measurements.

Two — `doubleClickDraft` and `phoneDraftHold` — pick a player out of the Draft
left panel, and the hydrated snapshot carries the COMPLETED 2026 draft: the top
panel reads DRAFT COMPLETE, none left, 483 of 594 cards drafted. There is nothing
to pick. Not a regression; the old in-browser seeding happened to leave an
unfinished draft. They need a fixture with picks remaining.

The third is the one genuinely unexplained failure in the whole batch: a scouting
reorder does not survive a reload. The stored data is correct, so it is rank
recomputation after a midpoint insertion — `boardRanking`, which `CLAUDE.md`
flags as the part most easily broken by a well-meaning change. **This is the
first thing to look at next.**
