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
