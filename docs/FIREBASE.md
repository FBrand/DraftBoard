# The shared backend

This branch is `pastel-lantern` plus one thing: the app can read and write a
**shared** store instead of only this browser's. Nothing else differs, and
lantern is kept a clean ancestor so the difference stays legible —
`git log pastel-lantern..firebase` is the whole of it.

## Keeping it that way: rebase, never merge

```sh
git checkout firebase && git rebase pastel-lantern
```

**Not `git merge pastel-lantern`.** Merging lantern up works, but it leaves a
merge commit every time, and they pile up fast enough to bury the branch's
actual content: 46 commits ahead of lantern, of which 36 were merges, and again
14-of-which-9 within a day. Rebasing keeps the delta as what it is — the
Firebase layer, as a short linear series on top of lantern.

Two rules that make it safe:

- **Keep a backup ref before rebasing** (`git branch -f firebase-prerebase <tip>`)
  and afterwards check what changed. The diff must be **exactly lantern's new
  work and nothing else**:

  ```sh
  git diff --name-only firebase-prerebase firebase
  git diff --name-only $(git merge-base firebase-prerebase pastel-lantern) pastel-lantern
  # these two lists must be identical
  ```

  When firebase had already merged lantern's tip, that set is empty and the
  check reads as "same tree, different history" — which is the form it took the
  first time and is a special case, not the rule. Anything in the first list
  that is not in the second means the rebase changed something of its own:
  abort and keep the merge history.
- **`BUGS.md` and `CLAUDE.md` will conflict on nearly every step**, because
  both branches write to them. Resolving toward the base to get the replay
  moving is fine, as long as the branch's own sections are restored from the
  backup at the end and the empty-diff check passes.

## Why it exists

The app is a broadcast companion. An analyst builds a board on air; the people
watching want to see it. Without a shared store every viewer sees the shipped
example and nothing the expert does.

## Two kinds of person, one kind of app

> An EXPERT is signed in with a real credential. He writes his own boards and
> the season they belong to.
>
> A VIEWER is anonymous. He gets a uid so the app can tell him from the next
> viewer, and he gets **no write access at all**. His own mock lives in his own
> browser.

That asymmetry is deliberate: ten experts' work is worth hosting, ten thousand
viewers' is not, and a viewer who can write is a viewer who can overwrite.

It is enforced in `firestore.rules` and **nowhere else**. `canEdit()` in the app
decides what the interface offers; it is not a security boundary, because
anything the browser decides, the browser can be made to decide differently.

**Evaluations (an expert's strengths/weaknesses/notes on a player) are
globally readable, and this stays true even once board-level visibility
exists.** They're keyed by author, not by board — one man's view of a player
runs across every board and season he's watched him — so no single board's
visibility setting could correctly govern them without either hiding an
author's notes from his OWN other boards, or requiring a duplicate
per-board copy of the same opinion. Decided, not overlooked: if per-author
note privacy is ever wanted, it needs its own flag on the author record,
not inheritance from a board.

## How a viewer gets both

`overlayAdapter` reads from Firestore and writes locally. A viewer sees the
expert's board, can tag and drag on top of it, and his edits survive a reload
laid over whatever Firestore currently says. He never asks the database for a
write it would refuse — the E2E probe asserts exactly that, because an app that
asks and is denied logs an error on every keystroke.

## The seam

`VITE_BACKEND` picks the adapter at build time; everything above it — the
repository, the stores, every view — is unchanged.

| value | store |
|---|---|
| `local` | this browser's localStorage. The default, and what lantern is. |
| `memory` | nothing persisted. The adapter that proves the seam is real: it deliberately has no `loadSync`, so any code that assumed reads were instant breaks loudly. |
| `firebase` | Firestore, with this browser overlaid on top. |

## Running it locally

```sh
npm run emulator                  # Firestore :8080 and auth :9099, in a container
npm run build:firebase            # builds dist-fb against the emulator
npx vite preview --outDir dist-fb --port 4177
```

The emulator needs Java 21 and most boxes have 17, so it runs from a
`node:20-alpine` container that installs a JDK into itself. Nothing is installed
on the host.

**The emulator starts empty.** Open the preview as an expert and the ordinary
first-run import seeds it, exactly as it seeds localStorage — same paths, same
short field names. That is the point: what Firestore holds is what the app
writes, not a fixture that can drift from it.

## Suites

```sh
npm run test:unit    # 549 — includes the adapters, the overlay, and the rules' logic
npm run test:rules   # 23  — the real rules against the real emulator
```

The rules suite is not a mock. It runs `firestore.rules` in the emulator and
asserts what an expert may do, what a viewer may not, and that batching works
against the real 500-write limit.

## Deploying

Config comes from the environment — see `.env.example`. None of it is secret: a
web app's Firebase config ships to every browser that loads the page. It
identifies the project; it does not authorise anything. The reason it is not
hardcoded is that a fork must not silently write into this project's database.

```sh
firebase deploy --only firestore:rules
```

## Authorized experts

Two collections, and the split matters:

- **`email2author/{email}`** — the access mechanism. **Existence is the
  permission**: an entry means that address may sign in as an expert, create
  its own author record, and read expert-gated content. The body holds only
  `invitedBy`/`invitedAt`; nothing inside it is read for a decision.
- **`authors/{uid}`** — the identity, keyed by the Firebase Auth **uid**.
  Created by the person themselves at first sign-in. Holds `name`, `email`,
  and an optional `deactivated` flag that is **informational only** — no rule
  reads it, ever.

`isExpert()` is therefore `google.com` + `email_verified` +
`exists(email2author/{lowercased email})` — **one** identity read. Keying
authors by uid is what keeps it to one: "which author am I" is answered by
the token itself (`request.auth.uid`), and "is this mine" is a field
comparison, so neither costs a lookup. `authors` is never consulted for
permission.

**Deploy rules before the client, every time.** The client checks
`email2author` on sign-in; if the new client ships to GitHub Pages ahead of
`firebase deploy --only firestore:rules`, every expert — including whoever
would be the first entry — gets refused by the *old* rules' catch-all deny,
which looks identical to "not invited" until the rules catch up.

**Adding an expert, once one already exists**: from the app — Manage →
Manage Experts… — which creates the `email2author` entry with `invitedBy`
set to the caller's own address (the rules enforce that; you cannot
attribute an invite to somebody else). Entries are immutable: `allow
update: if false`, so who-invited-whom cannot be rewritten after the fact.

**Deactivating**: deletes the `email2author` entry — that alone revokes,
immediately and everywhere, because existence *is* the permission. The app
also sets `deactivated: true` on the author (for display) and orphans that
person's boards, setting `o: null` so another expert can claim them. The
author record itself is never deleted (`allow delete: if false`): it is a
permanent identity, and every evaluation ever written in that voice is keyed
to it.

**Reactivating**: recreates the `email2author` entry, clears the flag, and
reassigns boards where `a == <that uid> && o == null` — the ones still
unclaimed. Anything another expert took over meanwhile has `o != null` and
is deliberately left with them.

**Bootstrapping a project is different, and has to be.** The `create` rule
requires already being an expert, so the first `email2author` entry can
never come from inside the app — by design; a rules language with no concept
of "this collection is empty" cannot express a self-service founder
exception that isn't itself a standing hole (an admin delete can re-empty
the collection later, so "empty" is never a safe one-shot signal).

A **fresh** project needs two kinds of out-of-band write, both bypassing
`firestore.rules` with Google Cloud IAM authority — the same access
`firebase deploy` itself uses:

1. **The founder's invite**, so somebody can sign in at all.
2. **The placeholder authors** (`a_dan`, `a_ryan` and their mock invites at
   `@draftboard.local`). These have *opaque* ids rather than uids, because
   nobody ever signs in as them — and `authors` `create` requires
   `authorId == request.auth.uid`, so the app itself correctly refuses to
   write them. That refusal is the rule working, not a gap to widen.
   `.local` is reserved by RFC 6762, so no real Google account can ever
   exist at those addresses and the mock invites can never become a way in.

From a machine logged in via `firebase login` with project access:

```sh
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME + '/.config/configstore/firebase-tools.json','utf8')).tokens.access_token)")
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://firestore.googleapis.com/v1/projects/<PROJECT_ID>/databases/(default)/documents/email2author/<email, lowercase>" \
  -d '{"fields": {"invitedBy": {"stringValue": "hand"}, "invitedAt": {"stringValue": "2026-01-01"}}}'
```

(`firebase firestore:delete` exists for admin-authority deletes; there is no
equivalent `firestore:write` in the CLI, which is why this goes through the
REST API directly with the CLI's own refreshed token.)

**The document id must exactly match the `email` claim the Google token
actually returns** — case and domain both. A near-miss (`gmail.com` vs. the
account's real domain, or any casing difference — the rules compare against
`request.auth.token.email.lower()`) means `exists()` misses forever, nobody
passes `isExpert()`, and no invite can ever be extended from the app again.
Confirm the real value first — sign in once and read it back from Firebase
Auth's user list — rather than assuming what an address "should" be.

## Three things that will bite

**Half a config is worse than none.** All four of `VITE_FIREBASE_API_KEY`,
`AUTH_DOMAIN`, `PROJECT_ID` and `APP_ID` must be present or `connect()` refuses
— and the refusal arrives as a console warning per collection, after which
every read returns `{}` and the app seeds itself a private season. It looks
exactly like a first run. That is why the build lives in a script rather than in
shell history.

**Rules read short field names.** Documents are stored with the names in
`src/data/fieldNames.js`, where field names were 40-45% of storage. Ownership is
`o`, not `ownerId`. Reading the long name does not deny quietly — it raises
"Property ownerId is undefined on object", which denies *everything*, and an
expert cannot write his own board.

**The emulator's debug logs grow without bound, and it matters.** At 2.4GB the
emulator degraded until a rules test that had always passed began failing; it
happened again at 920MB, taking 23 rules tests to 22 with nothing wrong in the
code. Both times the fix was to truncate and restart. `scripts/firestore-emulator.sh`
now empties them on every start, and they are gitignored. If a rules test fails
for no reason you can find, check the size of `firebase-debug.log` first.
