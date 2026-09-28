# DraftBoard — architecture and the shared backend

How the app is meant to be put together, and how it is meant to behave once
several people share one set of data. Compiled from the decisions taken over
the course of the project.

This is the intended end state, not a description of anything that exists. It
deliberately contains no code, no file names and no library specifics.

`SPEC.md` describes the product. This describes the machinery it has to sit on.

---

## 1. One app, several backends

One set of source code runs against any of:

- the **browser alone**, with nothing behind it;
- a **hosted document store** (Firebase);
- a **database in a container** (MongoDB), self-hosted.

Which one is in use is configuration, not a different build of the app and not
a fork. Everything above the storage seam — every view, every stage, every
rule about ranks and seasons — is identical in all three.

**Running with no backend at all is a first-class mode**, not a legacy path. A
viewer with no account and no network behind him gets a complete, working app
that keeps his work.

Two consequences that shape everything else:

- The app cannot assume a backend exists, so nothing outside the storage layer
  may know which one is in use.
- Anything a backend needs that the browser cannot provide — identity,
  permissions, other people's changes — has to degrade to something sensible
  rather than breaking the app.

The public build is a static site. It holds no secrets. Anything the client
decides about permissions is convenience only; the store itself is the
authority.

---

## 2. Who is who

**Experts** sign in and write to the shared store. **Viewers** do not sign in,
are given an identity automatically so their own work has somewhere to live,
and have no write access to shared data at all.

Identity works like this:

- A person is an **author**. One person, one author record, for good — not a
  user account on one side and an author on the other.
- The author's key is the identity the sign-in already provides, so asking
  "is this me?" never requires a lookup.
- An **invitation list keyed by email address** is the access mechanism. An
  entry on it means: this person may sign in, may create their own author
  record, and may read everything experts can see. Their author record is
  created on first sign-in.
- Everything else keys off the author. The invitation list exists so that
  permission can be checked without walking the rest of the data.
- **Removing the invitation removes access.** The author record stays, marked
  deactivated for the record only — the flag grants nothing and withholds
  nothing.
- An author may later carry a list of previous identities, so that somebody
  who changes account keeps the evaluations they wrote.

---

## 3. What the store must enforce

The client is public and inspectable, so these are guarantees the **store**
makes, not the app:

- Nobody writes in another person's name. Creating an author is possible only
  for yourself; inviting is possible only in your own name.
- Only an invited, signed-in person writes shared data.
- A board's own state decides who may write it — owned by you, shared with
  everybody, or claimable because nobody holds it.
- Visibility is enforced where the board's **content** lives, not only on the
  board's label, so a private board's placements are unreadable rather than
  merely unlisted.
- Whether a board may be claimed is derived from live truth — the holder's
  invitation either exists or it does not — rather than from a flag somebody
  remembered to set.

The app may work out the same answers in advance, to decide what to offer.
That is a convenience: a stale guess shows a button that fails cleanly, or
hides one until the next load. It is never the decision.

Permission checks must be cheap. Checking one place on every access is
acceptable; checking several is not.

---

## 4. Keeping devices in step

**Everything an expert changes reaches the other devices**, without anybody
reloading. That is the point of sharing data at all.

It is not uniform, because the cost is not uniform:

- **Live, continuously** — what is happening on air: the board being worked,
  the picks being made, the roster being moved.
- **Current when opened, not streamed** — written remarks. Opening a player's
  card must show what is current, without paying to re-read what has not
  changed.
- **Loading is visible** — a board that is still arriving says so rather than
  rendering as empty.

**Do not subscribe to things that cannot change.** A finished season's board is
an artifact; holding a live connection to it is waste.

### Changed-since markers

A board carries a marker saying when its contents last changed. Anybody holding
a copy compares that one small value against what they have, and only then
decides whether to fetch anything. The marker and the change it describes must
be written together, so it can never claim a change that did not happen or miss
one that did.

### Fetching only what changed

When a board has changed, fetch **only the entries that changed**, not the
board again:

- Every entry carries the moment it was last touched; all entries changed
  together carry the same moment, as does the board's marker.
- A deletion is recorded rather than being an absence, so a reader can tell
  "removed" from "not fetched".
- A reader asks for everything touched since the moment it last successfully
  caught up, applies what comes back, applies the deletions, and **only then**
  records the new moment.
- If the fetch fails, the recorded moment does not move. Catching up is always
  attempted from the last point that fully succeeded, so no change can be
  skipped.
- The first read of a board is still the whole board. Deltas are for
  afterwards.

---

## 5. Living inside the free tier

The hosted store runs **without billing enabled**. Its daily allowance is a
hard ceiling, and exceeding it stops the app for everybody until it resets.
Reads are the scarce resource.

This is a design constraint, not an optimisation:

- **Nothing is read at startup that is not needed to draw the first screen.**
- **Nothing is re-read that has not changed** — that is what the markers above
  are for.
- **Nothing is stored twice.** A board holds a player's ranking and tag and
  nothing else; who the player is is fetched once, separately, and shared by
  every board. There are no per-board copies of facts.
- **Shipped files seed the first state and are then irrelevant.** Once the
  store holds the data, the files are not consulted, not re-read on every
  start, and not shipped where they would be.
- Data written by the app carries no keys inside the body that are already the
  address, no long identifiers, and no field names longer than they need to be.
- Identifiers are opaque, short and single. No composite keys anywhere.

The read pattern is extreme and must be treated as such: a handful of people
write, and potentially **tens of thousands read**. Every read on the viewer
side is multiplied by the size of the audience.

---

## 6. The viewer fan-out

At broadcast scale the hosted store cannot serve the audience directly, and
should not be asked to.

A **relay** sits between them:

- It holds **no database**. Its state is a disposable in-memory copy, rebuilt
  from the store whenever it restarts.
- It follows the shared store with a **single connection**, as an ordinary
  anonymous reader — so it can never see more than a viewer is entitled to see.
- Viewers get **a snapshot of the current state**, then **a stream of changes**.
  It sends only what changed, not the whole board again.
- A viewer who loses the connection takes a fresh snapshot and resumes the
  stream.
- It speaks its own simple interface, not an imitation of the store's.
- **Experts read through it too, but never write through it.** Writes go
  straight to the store. Reads come from the relay for everything except the
  collections that are live during a broadcast, where an expert must not be
  silently stale, and except anything an anonymous reader may not see — which
  the relay, reading anonymously, could not serve in any case.

  *(Revised. This previously read "Experts do not use it. They stay connected
  directly, because they write." The relay already holds the state for the
  audience, and serving it to an expert costs nothing while removing most of
  his metered reads. See REBUILD-PLAN.md §7 for the freshness and restart
  obligations that come with it.)*

It starts as one small instance. Splitting it, or putting a cache in front of
it, happens only if measurement shows the connection count demands it.

The relay is not a step towards replacing the hosted store. Replacing that is
what the interchangeable-backend seam is for.

---

## 7. What lives in the browser, and for how long

Even with a backend, the app keeps a working set locally so it is fast and
survives going offline.

- Roughly the last few seasons are kept; more are kept as they are used.
- When the local budget gets tight, the **oldest season is dropped** — and with
  it, players nothing still refers to: not on a surviving roster, not on a
  surviving free-agency board, not part of a surviving draft class.
- Opening a season that is not held locally brings it in, replacing the oldest.
- The app knows how much room it is using and acts before it runs out.
- Anything not yet saved is written out **first**; until it is, nothing is
  dropped.
- With no backend there is nowhere to fetch a dropped season back from, so the
  app offers an export before anything is discarded.
- Searching while adding a player looks locally as you type, and asks the
  store only when you choose to add — so a name that already exists somewhere
  can be offered as a merge.

---

## 8. Getting data in

- **Shipped files create the first state and nothing more.** After that the
  store is the truth.
- Populating a shared store for the first time is done **from outside the app**,
  deliberately, by somebody with the authority to do it. It is not something
  every client attempts on startup.
- The shared data must be inspectable and repairable from outside, without
  going through the app.
- An **import by an expert is a proposal** — shown, reviewed and confirmed
  before anything is written.
- A file being imported is taken as internally consistent; entries are not
  merged with each other inside one file.
- Where the app matches names to people — importing, seeding, reading an
  external feed — it does so **once**, at the boundary. Afterwards, everything
  refers to people by identity, never by name.
- A third-party live feed is proof-of-concept only and never used publicly. The
  shape stays so that a legitimate source could be attached.

---

## 9. Never losing work

Writing can fail: no permission, no network, no room.

- A change is shown immediately and saved behind it.
- A failure is **visible**, never silent.
- A failed write is retried sensibly rather than discarded.
- If it cannot be saved at all, the work can be exported to a file so it leaves
  the machine intact.
- The interface says plainly whether what is on screen has actually been
  stored.

A change must never be reported as saved when it is not.

---

## 10. Shape of what is stored

At the level of principle, not layout:

- One record per player, holding what is true of him.
- One entry per player per board, holding only that board's opinion of him.
- Evaluations belong to the person who wrote them, stamped with the season.
- Archived seasons freeze placements; evaluations continue.
- Keys are opaque, short, and never repeated inside the thing they address.
- No composite keys.
- A single change writes a single record — moving one player does not rewrite
  a board.
