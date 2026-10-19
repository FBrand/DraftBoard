# Tests

Two suites, split by what the test actually needs.

**`tests/unit/` — Vitest, ~24 seconds.** Everything that is a function of
values: ranking, identity and name matching, CSV in both directions, draft
phases, the session bundle, board and author records, evaluations, the roster
sync. No DOM. `setup.js` supplies a twenty-line `localStorage` — not jsdom,
because nothing here touches a document.

**`tests/fast/` — Playwright, 37 tests, ~8 minutes.** What only a browser can
prove: drag-and-drop, clipping and stacking, a modal opening off-screen, a link
restoring what it says, a layout collapsing at the wrong width — and **wiring**,
which is the category that keeps costing real bugs. A rollover carried nothing
into a new season while fifteen unit tests passed over it, because they read
and wrote a store the app does not use. Unit tests cannot tell you that two
modules disagree about where the data lives; only driving the app can.

That is also why this suite is over its target — see The budget.

**`tests/audit/` — the sweep. Not part of `npm test`.** It LOOKS for problems
rather than asserting their absence: content escaping the viewport, controls
with no accessible name, text spilling out of its own box, console errors,
every stage at four widths. It passes while reporting problems, which is
exactly what a regression test must never do — so it is a tool to read, not a
gate. It also costs about a third of the browser budget for something that
cannot fail.

**The app against an adapter with no `loadSync`.** Every synchronous read in
this app is served by localStorage answering instantly, and no network can do
that — `memoryAdapter` omits `loadSync` on purpose, and its header claims the
omission is what makes those reads reveal themselves. That claim went untested
by actually running the app until it was run for real. It is what a shared
backend turns on, and it is worth keeping true on this branch too: a reader
that answers late must produce an empty board, not a crash.

It holds. Every stage fills from asynchronous loads alone — free agency 77
slots, scouting 328 rows, the draft 217 cards, UDFA 9, the roster 91 — nothing
bypasses the adapter into localStorage, and there are no console errors.

```bash
VITE_BACKEND=memory npm run build:memory
npx vite preview --outDir dist-mem --port 4174
docker run --rm --network host -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.55.0-noble node /work/.audit/noLoadSync.mjs
```

```bash
npm test                     # unit + browser, in order
npm run test:unit
npm run test:browser:docker  # the normal way to run the browser suite here
npm run test:audit:docker    # the sweep, when you want to go looking
```

The box is memory-bound rather than CPU-bound: 8 cores but ~1.8GB free with
four workers already swapping. More workers make it slower, not faster.

The npm `playwright` package is installed with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` because this host is memory-constrained;
the browsers come from the Docker image.

## Why it is shaped this way

There used to be one suite: 87 browser tests, `tests/*.spec.js`, around 40
minutes. Most of them were driving a browser to check something that was never
about the browser — that a CSV round-trips, that a rank is derived correctly,
that an import rejects a bad file. Each paid a ~20 second app boot to do it.

Those moved to Vitest, where they run in milliseconds, and the browser suite
kept the cases that earn their cost. The old suite was deleted only once the
new ones covered the same ground; see the commit that removed it for the
case-by-case mapping.

Two things keep the browser suite fast:

- **`globalSetup.js` boots the app once** and snapshots the state it settles
  on. A cold start fetches three rankings files, a 91-slot roster, the facts
  seed and the draft, and resolves ~700 players into the registry. That
  bootstrap is identical every time and is itself covered by unit tests, so
  paying for it 87 times bought nothing. Tests that need a cold or wiped app
  clear storage themselves — `openCold` in `helpers.js`.
- **Tests are dense.** Several old cases become one test, because the boot
  dominates the cost and assertions are nearly free. A test named for three
  things is deliberate.

## The budget

**Ten minutes, all in, is the hard limit.** A suite slower than that stops
being run, and a suite that is not run is not a suite. Targets: under 5
minutes for Playwright, under 1 minute for the unit tests.

Measured 2026-09-14: unit 52s, Playwright 8.0 min, **8.9 min all in**. Inside
the hard limit, over the Playwright target.

If the browser suite creeps up, the first question is whether the new test
needed a browser at all — not whether to raise the limit. Four tests were
added in the audit that found the rollover bug, at about two minutes:
`seasonRollover`, `writeRefused`, `draftComplete` and `fileIssues`. Each was
asked that question and each answered yes, because each proves a wiring
claim — that the rollover reaches the store the roster reads, that a refused
write reaches the widget, that `draftComplete` reaches the header, that
`duplicatesIn` reaches the screen. The logic underneath all four is unit
tested; it was the wiring that was broken.

Getting back under 5 minutes therefore means making the EXISTING tests
denser, not dropping these — several of the older ones pay a full boot to
assert one thing. That is its own piece of work and has not been done.

## Writing a browser test

- `openWarm(page, tab)` — the app with the snapshot already in storage.
  The guard inside it is load-bearing: `addInitScript` runs before *every*
  navigation, so without it a `page.reload()` re-injected the snapshot and
  silently undid whatever the test had just done.
- `openCold(page, tab)` — nothing in storage, the bootstrap path.
- `dragTo`, `slotNames`, `trackErrors` — see `helpers.js`.

Assert what a person would notice, and say why in a comment when the reason
is not obvious from the name. Several tests here exist because of a specific
bug; the comment naming it is the reason the test is still the right shape.
