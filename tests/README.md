# Tests

End-to-end Playwright tests that drive the real app against a running dev
server. There are no unit tests: nearly every bug this suite was built from
was a **rendering or interaction** bug (drag-and-drop, overflow clipping,
stacking contexts, a modal opening off-screen) that a unit test could not have
caught, and several of them shipped despite a green `npm run build`.

## Running

```bash
npm run test          # needs browsers installed locally
npm run test:docker   # runs in the official Playwright image (recommended here)
```

The npm `playwright` package is installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
because this host is memory-constrained — the browsers come from the Docker
image instead, which is why `test:docker` is the normal way to run.

`playwright.config.js` builds and serves the production bundle if a preview
server isn't already running, and reuses yours if it is. Set
`NO_WEBSERVER=1` to skip that and point at a server you started yourself.

Useful flags:

```bash
npm run test:docker -- --project=mobile        # phone-width specs only
npm run test:docker -- scouting.spec.js        # one file
npm run test:docker -- --trace on              # traces are off by default (see below)
```

## Layout

| Spec | Covers |
| --- | --- |
| `smoke.spec.js` | every tab renders without console errors; board scrolling; panel auto-scroll isolation |
| `roster-slots.spec.js` | depth-chart slots with holes — the cut/move regressions |
| `info-card.spec.js` | player info card: read-only outside Scouting, reachable from Draft/FA/Roster |
| `scouting.spec.js` | per-board evaluations, drag reordering, board CSV export |
| `session.spec.js` | whole-app session export/import round-trip and its failure modes |
| `ui.spec.js` | app-wide conventions: no native dialogs, Escape closes overlays, menus |
| `layout.mobile.spec.js` | phone-width layouts (runs only in the `mobile` project) |

## Conventions worth knowing

- **Runs in parallel.** Playwright gives every test its own browser context and
  localStorage is per-context, so even the specs that wipe and restore all app
  state can't reach each other. Three workers saturate a 4-core box; memory is
  not the limit (~674 MB average, no extra swapping), CPU is.

- **Use `dragTo()` from `helpers.js` for drag-and-drop.** Rolling your own
  mouse sequence tends to produce flaky, slow failures for two non-obvious
  reasons, both handled there: dnd-kit only activates a drag after 8px of
  movement, and its auto-scroll moves the target out from under coordinates
  measured before the drag started. It also guarantees the pointer is released
  — a drag left in flight makes every later step in the test time out waiting
  for something to become "stable".

- **`ensureRoster()` caches.** Loading the default roster takes ~20s, so the
  first load in a run is snapshotted and later calls seed `localStorage`
  directly.

- **Traces are off by default.** Writing trace archives into the bind-mounted
  repo is slow and unreliable; turn them on per-run when debugging.

- **Native dialogs are a failure.** `trackErrors()` treats any
  `window.alert`/`confirm`/`prompt` as an error — this is a broadcast tool and
  the app uses its own dialogs deliberately.

## Note on timings
The suite runs in roughly 9 minutes. It used to take 40, for two independent
reasons, both measured rather than guessed:
- It ran against the Vite **dev server**, which serves ~55 unbundled,
  unminified modules including React's development build. Every test pays that
  on its own page load — a warm-cache reload cost the same as a cold one, so it
  was execution, not download. Testing the production build also means testing
  what ships.
- It ran with **one worker**, on the mistaken belief that the specs shared
  localStorage.

Individual tests still take 20-60s, dominated by a full app boot per test.
Fixed `waitForTimeout` sleeps total well under 5% of the runtime, so they are
not where the time goes.