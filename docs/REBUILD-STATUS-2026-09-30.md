# The rebuild so far — honest status, 2026-09-30

52 commits, `35a7d89..HEAD`, pushed as `firebase0.2`. Measured against
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
| unit | 755 |
| rules | 122 (emulator) |
| browser | 50 pass, 1 skipped, 1 known failure |
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

## 5. Overlay removal — where it actually starts

**Step 1 is done** (`ae3723a`): the layered store can express a private write.
That was the blocker behind audit R8 — the overlay honours `{ mine: true }` and
the newer seam could not ask for one, so moving any collection across would have
started publishing every expert's what-if picks the day `players` moved.

**Step 2 hits a real obstacle, which is worth stating before somebody starts it.**
`appStore.MIGRATED` is a static list of collection names — `['evaluations']` —
and `isMigrated` matches a path against it by prefix. Every remaining candidate
embeds a season or board id in its path:

    seasons/{seasonId}/prospects
    seasons/{seasonId}/charts/{stage}/scopes/{whose}/rows
    boards/{boardId}/entries

A static list cannot express those, and prefixing on `seasons` would capture
every stage at once — which is the opposite of a collection-at-a-time migration.
So the first piece of step 2 is turning `MIGRATED` into a **predicate** over
paths, not adding a name to a list.

Two other things to know before starting:

- **`isMigrated` has no callers.** Nothing enforces the split; it is a comment
  with a function signature. Whatever replaces it should be asked by the thing
  that routes a read, or it will drift the same way.
- **Order matters.** `players` and `draft_state` are watched, and the live draft
  depends on following them, so they move last. Something owned by one module and
  watched by nothing goes first — `seasons/{id}/prospects` and its two siblings
  are the cleanest candidate, being three collections with a single owner.
