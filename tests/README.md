# Tests

Two suites, split by what the test actually needs.

**`tests/unit/` — Vitest, ~24 seconds.** Everything that is a function of
values: ranking, identity and name matching, CSV in both directions, draft
phases, the session bundle, board and author records, evaluations, the roster
sync. No DOM. `setup.js` supplies a twenty-line `localStorage` — not jsdom,
because nothing here touches a document.

**`tests/fast/` — Playwright, ~4 minutes.** What only a browser can prove:
drag-and-drop, clipping and stacking, a modal opening off-screen, a link
restoring what it says, a layout collapsing at the wrong width.

```bash
npm test                     # both, in order
npm run test:unit
npm run test:browser:docker  # the normal way to run the browser suite here
```

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

If the browser suite creeps up, the first question is whether the new test
needed a browser at all — not whether to raise the limit.

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
