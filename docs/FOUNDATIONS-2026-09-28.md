# DraftBoard — a map of what it stands on

2026-09-28. Produced by the same independent reviewer as `AUDIT-2026-09-28.md`,
resumed with its context intact. Remit: foundations only, ordered by depth, no
remedies and no sequencing. A foundation is something other things are built on
— an abstraction, a mechanism, a model, an assumption, an invariant other code
relies on. Sound foundations are included, so this is a complete map rather
than a list of faults.

Reproduced as delivered.

## The correction that reorders everything

The brief told the reviewer that `pastel-lantern` was believed solid and to
spend its effort on the layer above. It came back with the opposite, and the
claim has been independently verified with `git`:

- `withPending`, the reload-surviving retry queue (`pending_writes_v1`),
  `follow` / `startWatching` / `isLive`, `readFailed`, `ownerId` and
  `isExpert()` **all already exist on `pastel-lantern`**.
- **Neither adapter on that branch implements `watch`**, and
  `BACKENDS = ['local', 'memory']`.
- `src/data/types.js` is byte-identical between the branches, as is
  `ownerIdFor`.

So every one of those mechanisms is **dead code on the branch believed solid**,
and the firebase layer is the first thing that ever executed any of it.

Eleven of the fourteen rotten foundations below originate in `pastel-lantern`.
Two were already rotten there; the rest were latent — correct, or merely
ambiguous, for one person on one machine — and were activated by attaching a
store that makes the ambiguity decidable, and wrong.

---

Foundations only, ordered by depth. No remedies. Each entry: what it is, why the *idea* is rotten (or sound), what stands on it, whether the concept or only the build has to go, and confidence.

---

## Tier 0 — the storage seam. Everything in the app is above this.

### A1. The adapter contract in `src/data/types.js` is not a contract

**What it is.** The declared interface of the storage seam — the single document defining what a backend must provide. `src/data/types.js`, **unchanged between branches**.

**Why it is rotten.** It declares `name`, `load`, `loadSync?`, `set`, `remove`, `commit?`, `clear?`. The repository and the app now depend on **seven capabilities it does not mention**: `watch`, `commitMany`, `identity`, `newAuthorId`, `isExpert`, `readFailed`, `remoteDocs`. All seven are consumed by duck-typed probes — `adapter.watch ? … : …`, `adapter.readFailed?.(c)`, `adapter.remoteDocs?.(c)`, `!!adapter.loadSync`. So the seam is not an interface; it is a set of feature detections, and the *real* contract is distributed across the call sites that probe for it. Nobody can implement a backend from the document that exists to say how.

This is what `ARCHITECTURE.md` §1 claims is true — "One set of source code runs against any of… Which one is in use is configuration, not a different build and not a fork" — and it is false in a specific way: the app branches on *capability* constantly (`isLive()`, `loadFailed()`, `loadSync` presence). A third backend does not implement a contract; it reverse-engineers which probes matter.

**What stands on it.** Every store module (`boardEntries`, `stageStore`, `depthChartStore`, `docSet`, `draftStore`, `playerRegistry`, `evaluations`, `boardRegistry`), the repository, all four adapters, and the "runs against any of three backends" promise. The MongoDB backend in §1 does not exist and cannot be specified from here.

**In principle or as implemented.** As implemented. A storage seam is the right idea and the right shape. The contract is simply not written down.

**Confidence.** Verified — grep of `types.js` against the seven consumed methods; provenance from `git diff`.

---

### A2. The seam is whole-collection: `load(path)` in, a full document map out

**What it is.** `src/data/types.js`, `src/data/repository.js`, `src/data/firebaseAdapter.js:108-161`. A read is a collection; a snapshot is a collection; the cache is `collection -> {id: doc}` replaced wholesale. Originates in `pastel-lantern` (`load`/`loadSync`/`commit`); the firebase layer added `watch` *usage* but `follow`/`adapter.watch` were already in that branch's repository.

**Why it is rotten.** There is no way to ask for *what changed*. `load` has no `since`; `watch` hands back the whole collection every time; the cache has nowhere to record a per-document watermark. `ARCHITECTURE.md` §4 specifies exactly the opposite — per-entry "moment it was last touched", deletions recorded rather than absent, a caught-up marker that advances only on a fully successful fetch, "the first read of a board is still the whole board, deltas are for afterwards." **None of that is expressible through this interface.** And §5's entire read budget depends on §4 existing.

The one changed-since marker that does exist (`u`, `src/data/boardEntries.js:223-232`) proves the point rather than refuting it: its single consumer, `src/hooks/usePlayerTags.js:111-125`, implements "fetch only what changed" as `repository.invalidate(path)` followed by a full 328-document re-read.

**What stands on it.** The repository's entire cache and notify model; every `ready` / `readyVia` / `follow` call site; the free-tier arithmetic (≈1,450 documents for a first Draft load, ≈2,100 for Scouting, against 50,000/day — roughly 25–35 page loads a day for the whole audience); the per-document rules cost (an entry write is 3 document accesses; **measured**: the app's rules add ~28 ms per written document, 1.7× the write itself, 300-doc batch 5.0 s → 13.4 s); and the relay in §6, which is not built at all and which was the only stated answer to broadcast scale.

**In principle or as implemented.** **In principle, for a shared backend.** For a single browser, whole-collection reads are correct and free. The concept has to go and take the repository's cache model with it.

**Confidence.** Verified — interface read; read counts derived from the code's own figures (`playerRegistry.js:38` "728 documents", `useBoardRankings.js:173-176` "328 each… 1,312 documents"); rules cost measured against the emulator.

---

### A3 + A4 are entangled and cannot be separated

#### A3. "Reads are synchronous, writes are asynchronous" — **sound**

`src/data/repository.js:9-24`. The board re-ranks hundreds of players per keystroke and cannot await a frame; a live document store genuinely works this way. This is the best decision in the codebase and the shape is right. It originates in `pastel-lantern`. It survives contact with a shared backend intact.

#### A4. The cache is the read path, and a queued write is indistinguishable from stored truth

**What it is.** `withPending()` (`repository.js:48-64`) lays the pending and in-flight queues over the store's answer on every read. Plus the reload-surviving queue (`QUEUE_KEY = 'pending_writes_v1'`). **Both originate in `pastel-lantern`**, verified.

**Why it is rotten.** Against localStorage the only way to fail is a full quota, so "keep the write and retry" is unambiguously right and the overlay is invisible. A store with *rules* introduces a third outcome the model has no room for: a write that is **judged and permanently refused**. Such a write can neither land nor leave, and `withPending` therefore shows it as stored, forever, on every read, across reloads. The repository says this about itself (`:729-745`): "That is not a safety net. That is somebody being shown their own rejected copy of a board belonging to somebody else, for good."

The flaw is in the idea, not the code: the model has two states (*saved* / *not saved yet*) for a world with three (*saved* / *not yet* / *never*). `discardPending` is an escape hatch bolted on, not a correction — it requires the user to notice, and it takes a reload.

**What stands on it.** This is the amplifier under every permission failure in the layer. It converts each of the following from a visible error into silent divergence: an expert writing an evaluation on a personal board (A9 — **verified refused**, permanently); an expert editing an orphaned board the UI offers as editable; an entry batch refused because a stale board document rode along with it (A18); a re-invite hitting `allow update: if false`. `ready`, `readyVia`, `startWatching`, `ensureLoaded` and `storedDocs` all exist to work around or partially undo this merge — `storedDocs` and `fromStore` were added *this session* (uncommitted) for exactly that reason.

**Entanglement.** A4 is not removable without A3. Optimistic-local-first reads are *why* the cache is the read path. And the uncommitted `storedDocs`/`fromStore` work is a third layer of shadow state (store answer, cache, queue) trying to recover a distinction the merge destroyed — so the entanglement is tightening, not loosening.

**In principle or as implemented.** Rotten in principle **as extended to a store that can refuse**. The queue itself is sound; laying a *refused* write over reads indefinitely is the rotten part, and that is a design decision, not a bug.

**Confidence.** Verified — code read, provenance via `git`, and the fatal instance (A9) measured against the emulator.

---

## Tier 1 — identity. Everything about players, boards and people.

### A5. Opaque registry ids; a name is never an identity — **sound**

`src/utils/playerRegistry.js`, `src/data/types.js:61`. Originates `pastel-lantern`. Correct, and correct for the right stated reason. Contaminated only by A6.

### A6. Name-matching survives as a fallback on the boot, read and write paths

**What it is.** `resolveAll(candidates, { create: true })` — fuzzy matching (Levenshtein via `findMatchingIndex`) that *mints* records. Called from `src/hooks/useDraftState.js:256` on **every mount**, from `useBoardRankings.js:251` at boot, and from `draftStore.js:167-173` during a pick. Plus `entryDocId`'s fallback to `identityKey(name, position)` (`boardEntries.js:104`) and `rosterSync`'s name-keyed membership tests (`rosterSync.js:52-55`). Originates `pastel-lantern`.

**Why it is rotten.** `ARCHITECTURE.md` §8 states the invariant the registry exists to provide: matching happens "**once, at the boundary**. Afterwards, everything refers to people by identity, never by name." The invariant does not hold. Matching runs on the hot path, at boot, for every user, unconditionally — and with `create: true`, so a name the registry cannot account for becomes a *new record*. On a single browser that is a private duplicate. Against a shared registry with `allow write: if isExpert()`, it is a duplicate in everybody's data, minted by whoever loaded the page.

`entryDocId`'s fallback additionally mints a **name-derived composite document id**, against §5's "Identifiers are opaque, short and single. No composite keys anywhere" — inside the collection whose whole purpose is to not do that.

**What stands on it.** The registry's own guarantee; the Draft/UDFA pool; the roster's dedupe (two players sharing a name — which SPEC §3 explicitly permits — collapse to one); board entry keys; BUGS.md's twelve-duplicates incident, whose trigger is still attached and now writes to shared data.

**In principle or as implemented.** As implemented — the *boundary* is in the wrong place. The concept (match once, then ids) is sound; it is simply not where the code does it.

**Confidence.** Verified by reading; the CI workflow corroborates ("useDraftState builds the Draft and UDFA pool straight from the rankings CSV and has no other source… Two independent pool builders, one following 'storage is the truth' and one not").

### A7. An author *is* the signed-in uid — **sound, and the best decision in the firebase layer**

`firestore.rules:29-42`, `src/data/firebaseAdapter.js:95-102`. New in firebase. It makes "is this author me" a token comparison with no document read, which is what keeps the ownership rules cheap at all. The reasoning is correct and the shape is right. It is betrayed from two directions, by A8 and A9 — not by itself.

### A8. Placeholder authors with opaque ids in the shipped seed

**What it is.** `src/utils/boardRegistry.js:154-163`. The shipped Dan and Ryan boards get author records with opaque `a_…` ids and `@draftboard.local` addresses, "deliberately not keyed by a uid." The *structure* originates in `pastel-lantern`; firebase added the email and the mock invite.

**Why it is rotten.** In a model where author == uid (A7), an author with a non-uid id is an author nobody can ever be. The seed therefore creates boards whose author is permanently a fiction, and the rules make that permanent: board `update` freezes `a` (`firestore.rules:479`), `authors` is `delete: if false` (`:387`), and `create` demands the id be your own uid (`:378-380`). **Nothing in the app can ever change a board's author.**

**What stands on it.** Directly fatal in combination with A9. Also: the board list shows an author who is not the person working it; remarks are attributed to a fiction; and `ownerRevoked()` — which walks `authors/{uid}` — never applies to a placeholder, so the shipped boards' claimability is governed by a path the rules were not written for.

**In principle or as implemented.** In principle, *given A7*. A placeholder identity is coherent in a branch with no sign-in; it is incoherent the moment identity is the sign-in.

**Confidence.** Verified; consequence measured (A9).

### A9. `ownerIdFor(board) = board.authorId ?? board.id` — an evaluation's voice derived from the board

**What it is.** `src/utils/evaluations.js:29-31`. **Unchanged from `pastel-lantern`.**

**Why it is rotten.** Two defects in one line. First, it is a key space holding **two different kinds of thing with no discriminator** — an author id or a board id, decided by whether the board happens to have an author. Second, it derives *whose voice this is* from the board, while `firestore.rules:198-201` derives writability from the **token**. Those two only agree when `board.authorId` equals the writer's uid — which A8 guarantees will never happen on the shipped data.

**Measured**, emulator, with exactly the seeded shapes:

```
claim b_dan (ownerId = his uid):                            ALLOWED
write an ENTRY on the board he now owns:                     ALLOWED
write a REMARK in the voice ownerIdFor() gives (a_1):        REFUSED (permission-denied)
write a REMARK keyed by his OWN uid (what the rules expect): ALLOWED
write a REMARK in the consensus voice (= board id):          ALLOWED
```

**No expert can write a single strength, weakness or note on any personal board in the shipped data.** Via A4 he sees them on screen indefinitely while the database holds none.

**Was it rotten in `pastel-lantern`?** Latent, not rotten. With no auth and no rules, board-derived voice is merely *ambiguous* — there is no second opinion to contradict it, and that branch's own header even argues the opposite intent ("Remarks therefore live per AUTHOR and player, not per board"). It became rotten the moment a rules layer supplied a token-derived answer to the same question. This is the clearest case in the audit of inherited latent rot activated by the new layer.

**What stands on it.** SPEC §3 (the player card, "every evaluation… from every author", grouped under the author's name) and SPEC §4 (the verification step's strengths/weaknesses/notes buttons) are both non-functional for personal boards. Also: a remark keyed by a board id is **permanently unwritable if the board is deleted** — `scrapSeason` removes boards and leaves evaluations "deliberately alone", and `ownsVoice` requires `boardExists`. And `ownsVoice`'s board branch costs two extra document accesses on the write path.

**In principle or as implemented.** In principle. A key space with an undiscriminated union in it cannot be repaired by better code. SPEC §11 already names author-keyed evaluations as the intended direction, so the concept is already known to be the wrong one.

**Confidence.** Verified by reading and **measured** against the emulator.

---

## Tier 2 — who may write. Built on Tier 1.

### A10. `writesRemote` — one session-global boolean routing every write

**What it is.** `src/data/backend.js:57` (`writesRemote: isExpert`), consumed at `overlayAdapter.js:211`, `:216`, `:225`, `:253`, `:278`. New in firebase.

**Why it is rotten.** It answers "where does a write go" for the *session*, when the real question is per *target*. An expert is not uniformly a remote writer: he may write his own board and the shared board, may not write an orphaned one or another expert's, and may want a private play-along of his own. One boolean cannot express that, so two failure modes are structural rather than incidental: a write that should be refused becomes refused-forever (A4), and a write that should be remote silently goes local.

The second is the **demoted-expert shadow copy**, which `src/utils/auth.js:435-453` carries a long comment claiming to have fixed. It has not. The fix keeps the session but leaves `isAllowed: false`; `writesRemote` reads `isAllowed`; so every write still goes local. `unconfirmed` reaches only a label and a button (`SessionUser.jsx:43,82`) and `editRefusal()` never consults it, so `canEdit()` stays true and a session's work lands in a private shadow.

**What stands on it.** Every write in the app. The expert/viewer asymmetry that is the whole point of the overlay. And the boot race (A21): during sign-in `isExpert()` is false, so boot-time seeding goes local.

**In principle or as implemented.** In principle — the granularity is wrong, not the code.

**Confidence.** Verified.

### A11. The overlay: local document wins, forever, per document, with no way back

**What it is.** `src/data/overlayAdapter.js`. New in firebase, and the single largest new idea in the layer.

**Why it is rotten.** Three flaws in the concept, not the build.

*It has no notion of time or version.* A local document wins over the remote one permanently, whatever their ages. There is no divergence marker, no expiry, no "take theirs". `SPEC.md` §11 legitimately parks *what the default should be* — it does not park *whether there is any way back at all*, and there is none.

*It assumes documents are small and single-purpose.* The header's own example — "one small document into his own browser; the next read hands back the expert's board with that one placement replaced" — is true of board entries and of nothing else. It is false for `players` (A17), `prospects_v1` and `draft_state` (A17), where the local document is an entire shared stage or a global fact record.

*The tombstone is a second kind of document in the same collection.* `{__deleted: true}` lives in the local half of a real collection, and only `overlaid()` knows to drop it. Anything reading the local half directly sees a document that is not one.

**What stands on it.** The entire viewer experience — SPEC §6's promise that a viewer "can build and keep their own version locally". `overlay.clear(path)` additionally routes to `remote.clear(path)` for an expert, i.e. deletes the whole shared collection, reachable from `clearRegistry()` and `evictSeason`.

**In principle or as implemented.** **The idea is salvageable with the same shape; the shape as built is not.** "The viewer writes *over* rather than *to*" is the right answer to the asymmetry. Unscoped, unversioned and one-way is the rotten part.

**Confidence.** Verified.

### A12. "The client decides what to offer; the store decides what lands" — **sound in principle, with a rotten subject model**

`firestore.rules:18-20`, `src/utils/permissions.js`. The division is exactly right and stated well. What is rotten is the *subject model* `editRefusal` gates on: `{ ownerId, kind }`, originating in `pastel-lantern`. A board is now a three-state machine (owned / orphaned / shared) plus a visibility, and a two-field subject cannot express it. So `editRefusal` never refuses an **orphaned** board — `subject.ownerId` is null, the `if` at `:95` is skipped — and `ScoutingView.jsx:105` opens it fully editable while `firestore.rules:481-487` refuses every write (the rules suite confirms the refusal at `tests/rules/rules.test.js:449`). Against SPEC §6: "Orphaned — … nobody can write it." Compounded by A4 into permanent silent divergence.

Also inherited: `pastel-lantern`'s `permissions.isExpert()` reads `provider !== 'anonymous'` — a *second, weaker* definition of expert. The firebase layer changed it to `isAllowed === true` and its comment brags about there now being "one source for it"; the three-disagreeing-answers problem it describes was real and was on that branch.

**Confidence.** Verified.

### A13. Invite-existence is the whole of permission, with no tiers

**What it is.** `email2author` existence ⇒ expert. `firestore.rules:60-66`, `:281-300`. New in firebase.

**Why it is rotten.** Existence-as-permission is a genuinely good primitive — it breaks the bootstrap circle (an invite can exist before its person does) and it is one read. What is rotten is that it is the **only** primitive: there is no tier above it. `allow delete: if isExpert()` means any invited person can revoke every other invited person, including whoever created the project; `revokeExpert`'s self-revocation guard (`auth.js:326-328`) is a JavaScript `if`; and no rule prevents the last invite from being deleted. Combined with `allow write: if isExpert()` on `players`, `seasons/**` and `draft_state` — no owner, no author scoping anywhere — every expert is a superuser over every stage except boards.

**What stands on it.** All of SPEC §6's access model. The four non-board stages have no ownership concept at all, which leaves an unresolved product question the architecture never addresses: boards are per-author, roster/FA/draft/prospects are singular and global, and the code silently answers "two analysts share one, last write wins, no conflict signal."

**In principle or as implemented.** As implemented — the primitive is sound, the flat topology is not.

**Confidence.** Verified from the rules; the revoke-everyone path is inferred from the rule text, not executed.

---

## Tier 3 — the shape of stored data. Built on Tiers 0–2.

### A14. One document per player per board — **sound**

`src/data/boardEntries.js`, `boards/{id}/entries/{playerId}`. Originates `pastel-lantern`. The best-shaped collection in the app; the rule-per-path and one-write-per-move arguments are both correct and both hold up.

### A15. Only tier and within-tier position stored; total and positional rank derived — **sound**

Satisfies SPEC §3's "so they can never disagree with the board." Originates `pastel-lantern`. No fault found.

### A16. One document per depth-chart row (`docSet`) — **sound**

`src/data/depthChartStore.js`, `src/data/docSet.js`, **unchanged between branches**. Per-row granularity, correctly reasoned, and it is what saves the roster and free agency from A17's problem.

### A17. Stage blobs, and a pick as a fact on the global player record

**What it is.** Two things, one flaw. `src/data/stageStore.js:41` — `prospects_v1` and `nfl_draft_board_state` are one document per stage per season, whole-blob rewrite. And `src/data/draftStore.js:152-196` — a pick is recorded by mutating the player's registry record (`setFactsMany`) rather than as a record of its own. Both originate `pastel-lantern`; `stageStore`'s header states the limit outright ("it is not per-player granularity… the last one wins").

**Why it is rotten.** Coarse documents defeat A11 completely. Under the overlay, a viewer who touches a blob once shadows *every expert's* work on that stage permanently. And because a pick is a fact on the global player, a viewer running the play-along draft SPEC §6 promises him **permanently freezes a few hundred shared player records in his browser** — no later correction to a name, school or matrix score ever reaches him for those players again. For an expert, `writeDraft` writes draft outcomes into the one collection every viewer reads, governed by `allow write: if isExpert()` with no scoping.

"A pick is a fact on the player" was a *good* consolidation on a single-user branch — it removed a genuine second source of truth (BUGS.md line 187 prices it at 210KB and two disagreeing answers). It becomes rotten only where the player record is global, shared, and overlay-covered.

**What stands on it.** SPEC's stage-feeds-stage model; the roster fill; the viewer's play-along; `ARCHITECTURE.md` §10's "A single change writes a single record."

**In principle or as implemented.** The blobs: as implemented (`depthChartStore` already demonstrates the right shape — the migration simply was not finished). The pick-as-player-fact: **in principle**, once the registry is shared.

**Confidence.** Verified.

### A18. The board document doubles as the change marker and is rewritten whole from cache by every entry write

**What it is.** `src/data/boardEntries.js:223-232`. Every `writeEntries` appends `{ ...board, u: Date.now() }` — a whole-document overwrite assembled from the local cache — to the entry batch. New in firebase.

**Why it is rotten.** Three separate faults from one decision. It makes "a player moved" and "the board record changed" the same write, contradicting `ARCHITECTURE.md` §10 directly. It is a read-modify-write of a whole document from a cache that may be stale, so a concurrent visibility or label change is lost. And because `ownershipWouldBeSafe` (`firestore.rules:480`) validates the incoming `o` against the *stored* one, a stale cached `o` refuses the **entire batch** — all 328 entries into A4's permanent-overlay state. The marker's correctness argument (atomicity with the change) is right; carrying it on the whole parent document is what is wrong.

Its only consumer implements the saving it exists for as invalidate-plus-full-refetch (`usePlayerTags.js:111-125`), whose safety rests on a comment asserting global app structure ("ScoutingView is the only thing that follows this path, App.jsx renders one view at a time") — an invariant nothing enforces, whose violation makes a subscriber "go quiet for good" by its own account.

**In principle or as implemented.** As implemented. A changed-since marker is exactly what §4 asks for; putting it on a document that has other owners and other writers is the rotten part.

**Confidence.** Verified.

### A19. Short field names — **sound**

`src/data/fieldNames.js`. Real, measured saving (40–45% of several collections). The one cost — the rules must be written against `o`, not `ownerId`, and reading the long name denies everything — is documented at `firestore.rules:68-76` and was paid once.

### A20. A remark handle is an array index

`src/utils/evaluations.js:87` — `{season}:{kind}:{index}` into an array inside a per-owner-per-player document that deliberately does not stream live. Originates `pastel-lantern`. Rotten in principle for concurrent editing: an edit computed from a stale copy deletes a different line than the one on screen. The comment acknowledges it and accepts it for a 21% size saving — a defensible trade for one person on one machine, and a silent data-corruption path for two devices, which SPEC §6 requires to work.

---

## Tier 4 — bootstrapping and lifecycle.

### A21. Shipped CSVs create the first state, from inside the client, on boot

**What it is.** `openBoards()` (`boardRegistry.js:102-172`) seeds a season, authors, boards and invites when it finds none; `loadPools` (`useBoardRankings.js:334-360`) seeds every board's entries from its rankings file; `useDraftState` seeds the draft from `DraftBoard_Picks.csv`; `seedExampleEvaluations` seeds remarks. Originates `pastel-lantern`, where it is *correct* — it is how a single-browser app bootstraps.

**Why it is rotten now.** `ARCHITECTURE.md` §8: "Populating a shared store for the first time is done **from outside the app**… It is not something every client attempts on startup." It still is. Every client still runs the seeding code; the only thing preventing it in production is a CI step that deletes the CSVs from `dist/`, and `.github/workflows/deploy.yml` states this as the design: *"Withholding the files is deliberately the whole mechanism… No seeding code changes, nothing to keep in sync with a flag."* Three independent silent-failure behaviours (a caught fetch, an empty body read as no rows, a pool-less `seedBoard`) are load-bearing as a data-integrity guarantee. `scripts/build-firebase.sh` does not strip the files, so every local Firebase build runs a code path production does not have.

Seeding is also **identity-generating and non-idempotent** — `newId` mints fresh ids against the *merged* cache — so it cannot converge. Combined with A10: `main.jsx:24-44` does not await `startAuth()` before `render()`, so boot seeding runs while `isExpert()` is still false and goes **local**; `main.jsx:36-41` then re-runs `openBoards()` on auth change, `storedDocs(BOARDS)` is still `{}` because `lastRemote` only records remote answers, and **it seeds a second time, remotely, with different ids** — leaving two `status: 'current'` seasons of the same year and six boards in the expert's own browser, with `currentSeason()` choosing arbitrarily between them.

**What stands on it.** The first-run experience on both branches; every viewer who arrives before the external seed keeps a private season forever (no reconciliation — A11); `ARCHITECTURE.md` §5's "Shipped files seed the first state and are then irrelevant… not re-read on every start" is false for four files.

**Entanglement.** A21 is not separable from A10 and A11: seeding-in-the-client is only *catastrophic* because the write routing is session-global and the divergence it produces is permanent.

**In principle or as implemented.** In principle, for a shared store. The concept "the client bootstraps itself from shipped files" and the concept "one shared store is the truth" cannot both be true.

**Confidence.** Verified by reading; the duplicate-seed sequence is inferred from the code path (mechanism confirmed line by line, not driven in a browser).

### A22. The season as the scope unit, and seasons as a stack — **sound as a model**

`boardRegistry.js`, `seasons/{id}/…`. Originates `pastel-lantern`. The model is right: one season per year, one current, archived boards frozen, evaluations stamped rather than owned. Path-scoping everything season-owned under the season (so `firestore.rules:399-403` is one rule) is a good consequence.

What is not sound is not the model but the *lifecycle operations*: `scrapSeason` (`boardRegistry.js:396-424`) is roughly a dozen unsequenced optimistic client writes — boards and 328-document entry deletes first, the season record last — with no atomicity and no verification. A failure between them leaves boards deleted and the season alive, or no current season at all, at which point `createBoard` and `startSeason` both return null. It looks like it worked regardless, because every write is optimistic-local.

### A23. The local storage budget and eviction model — **written, tested, never wired**

`src/utils/seasonStorage.js` — `storageUsage`, `seasonFootprint`, `reachablePlayerIds`, `oldestEvictable`, `evictSeason`. **Unchanged between branches, and dead on both**: verified, the only importer anywhere on either branch is `tests/unit/seasonStorage.test.js`.

So `ARCHITECTURE.md` §7 is entirely absent as a foundation: the app does not know what it is using, nothing is evicted, no export is offered before discarding, nothing "acts before it runs out." BUGS.md item 23 measures a genuinely scouted season at 0.5–1.1 MB against a ~5 MB cap — four to ten seasons before writes start throwing, into A4's queue.

Not rotten in principle; simply not a foundation, despite being documented as one and carrying a passing test suite. That combination is the fault worth naming: **a green suite over code the app never runs reads as coverage.**

---

## Tier 5 — verification. What the other foundations are checked against.

### A24. The test strategy's axis: "a function of values" → vitest, "needs a browser" → Playwright

`vitest.config.js:1-7`, `tests/README.md`. Originates `pastel-lantern`, where the axis is complete because there are only two kinds of thing.

**Why it is rotten now.** The firebase layer added a third kind — *composition against a fallible remote store with rules* — and the axis has no bucket for it, so it falls off both sides. `vitest.config.js:32` forces `VITE_BACKEND: 'memory'`, so the overlay adapter, `writesRemote`, the refused-write path and the boot/auth race are **never exercised in composition** with the repository or the stores; only in isolation, in `overlayAdapter.test.js`. And `test:rules` is deliberately excluded from `npm test` (`vitest.rules.config.js:6-9`), so the security boundary is not in CI.

The rules suite itself is genuinely thorough (~70 cases across the permission matrix) and is the strongest artifact in the layer. It has one revealing blind spot that follows from the axis rather than from carelessness: `tests/rules/rules.test.js:188` — `it('refuse a voice belonging to no author and no board')` — asserts A9's fatal refusal is *correct behaviour*, because nothing in the suite's world knows what the shipped seed actually writes.

**In principle or as implemented.** As implemented — the axis needs a third arm, not replacing.

**Confidence.** Verified.

---

## Summary map

| | Foundation | Origin | Verdict |
|---|---|---|---|
| **0** | A1 Adapter contract (`types.js`) | pastel-lantern | rotten as implemented — undeclared, duck-typed |
| | A2 Whole-collection read/watch seam | pastel-lantern | **rotten in principle** for a shared store |
| | A3 Sync reads / async writes | pastel-lantern | **sound** |
| | A4 Cache-as-read-path + `withPending` | pastel-lantern | **rotten in principle** once writes can be refused — *entangled with A3* |
| **1** | A5 Opaque registry ids | pastel-lantern | **sound** |
| | A6 Name-matching on boot/read/write paths | pastel-lantern | rotten as implemented — boundary in the wrong place |
| | A7 Author == signed-in uid | firebase | **sound** |
| | A8 Placeholder authors in the seed | pastel-lantern (structure) | **rotten in principle** given A7 |
| | A9 `ownerIdFor` — board-derived voice | pastel-lantern, **latent there** | **rotten in principle** — verified fatal |
| **2** | A10 `writesRemote` session boolean | firebase | **rotten in principle** — wrong granularity |
| | A11 The overlay | firebase | idea salvageable, **shape rotten** |
| | A12 Client offers / store decides | pastel-lantern | **sound**, with a rotten subject model |
| | A13 Invite-existence, flat, no tiers | firebase | rotten as implemented — no topology |
| **3** | A14 One entry per player per board | pastel-lantern | **sound** |
| | A15 Derived rank | pastel-lantern | **sound** |
| | A16 Per-row depth chart (`docSet`) | pastel-lantern | **sound** |
| | A17 Stage blobs; pick as global player fact | pastel-lantern | blobs: as implemented; pick-as-fact: **in principle** |
| | A18 Board doc as change marker, rewritten whole | firebase | rotten as implemented |
| | A19 Short field names | pastel-lantern | **sound** |
| | A20 Remark handle as array index | pastel-lantern | **rotten in principle** for concurrent editing |
| **4** | A21 Client-side seeding from shipped CSVs | pastel-lantern | **rotten in principle** — *entangled with A10, A11* |
| | A22 Season as scope unit / stack | pastel-lantern | **sound model**, non-atomic operations |
| | A23 Local budget & eviction (§7) | pastel-lantern | not a foundation — dead on both branches |
| **5** | A24 Test strategy axis | pastel-lantern | rotten as implemented — no bucket for the seam |

**Three entanglements, stated explicitly.** A3+A4 (optimistic reads are why the cache is the read path). A8+A9 (each is survivable alone; together they make personal boards un-annotatable). A10+A11+A21 (seeding in the client is only catastrophic because routing is session-global and divergence is permanent).

**Not built at all, and therefore not foundations despite being documented as such:** §4's delta mechanism, §6's relay, §7's eviction, §1's third backend.

**The load-bearing correction:** eleven of the fourteen rotten foundations originate in `pastel-lantern`. Two were already rotten there (A1, A23); the rest were latent — correct, or merely ambiguous, for one person on one machine — and the firebase layer activated them by attaching the store that makes the ambiguity decidable and wrong. The branch believed solid is where most of this lives, and a substantial amount of the multi-user apparatus on it (`withPending`, the persistent queue, `follow`/`watch`, `ownerId`, `isExpert`) was never executed once before the firebase layer ran it.
