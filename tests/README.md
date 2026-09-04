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

`playwright.config.js` starts a dev server if one isn't already running, and
reuses yours if it is. Set `NO_WEBSERVER=1` to skip that entirely and point at
an already-running server.

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

- **Serial by design.** The app keeps all its state in `localStorage`, and
  several specs deliberately wipe or restore *all* of it. `workers: 1` in the
  config is load-bearing, not a performance oversight.

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

Individual tests take 20-90s. That's dominated by real app work (fetching and
rendering a ~90-slot depth chart, full page reloads to verify persistence), not
by fixed sleeps. The whole suite runs in roughly 15 minutes.
