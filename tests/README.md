# Tests

End-to-end Playwright tests that drive the real app against a production
build. There are no unit tests: the bugs this suite exists to catch are
rendering and interaction bugs — drag-and-drop, overflow clipping, stacking
contexts, a modal opening off-screen — which a unit test cannot see and which
a green `npm run build` does not rule out.

## Running

```bash
npm run test          # needs browsers installed locally
npm run test:docker   # runs in the official Playwright image (recommended here)
```

The npm `playwright` package is installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
because this host is memory-constrained — the browsers come from the Docker
image instead, which is why `test:docker` is the normal way to run.

`playwright.config.js` builds and serves the production bundle if a preview
server isn't already running, and reuses yours if it is. Set `NO_WEBSERVER=1`
to skip that and point at a server you started yourself.

Useful flags:

```bash
npm run test:docker -- --project=mobile        # phone-width specs only
npm run test:docker -- scouting.spec.js        # one file
npm run test:docker -- --trace on              # traces are off by default (see below)
npm run test:docker -- --workers=1             # serialise, e.g. to debug a flake
```

The full suite takes roughly 9 minutes. Individual tests take 20–60s, almost
all of it a full app boot per test.

## Layout

| Spec | Covers |
| --- | --- |
| `smoke.spec.js` | every tab renders without console errors; board scrolling; panel auto-scroll isolation |
| `init-modes.spec.js` | seeded vs clean start, and what a clean slate keeps |
| `roster-slots.spec.js` | depth-chart slots with holes — the cut/move regressions |
| `undo.spec.js` | undo in Roster, Free Agency and Scouting |
| `info-card.spec.js` | player info card: read-only outside Scouting, reachable from Draft/FA/Roster |
| `scouting.spec.js` | per-board evaluations, drag reordering, board CSV export |
| `scouting-params.spec.js` | derived ranks, tiers, per-board player pools, tag markers |
| `add-prospects.spec.js` | adding players missing from the rankings: entry, verification, collisions |
| `linking.spec.js` | view/board/player in the URL, back and forward |
| `session.spec.js` | whole-app session export/import round-trip and its failure modes |
| `ui.spec.js` | app-wide conventions: no native dialogs, Escape closes overlays, menus |
| `layout.mobile.spec.js` | phone-width layouts (runs only in the `mobile` project) |

## Conventions worth knowing

- **Tests run in parallel and must stay independent.** Each test gets its own
  browser context, so `localStorage` is per-test — specs that wipe or restore
  all app state can't affect each other. Don't introduce shared state that
  breaks that.

- **Use `dragTo()` from `helpers.js` for drag-and-drop.** Rolling your own
  mouse sequence tends to produce flaky, slow failures for two non-obvious
  reasons, both handled there: dnd-kit only activates a drag after 8px of
  movement, and its auto-scroll moves the target out from under coordinates
  measured before the drag started. It also guarantees the pointer is
  released — a drag left in flight makes every later step time out waiting for
  something to become "stable".

- **Use `ensureRoster()` to get a populated roster.** It snapshots the first
  load and seeds `localStorage` directly afterwards, which is much faster than
  loading it per test.

- **Traces are off by default.** Writing trace archives into the bind-mounted
  repo is slow and unreliable; turn them on per-run when debugging.

- **Native dialogs count as failures.** `trackErrors()` treats any
  `window.alert`/`confirm`/`prompt` as an error — this is a broadcast tool and
  the app deliberately uses its own dialogs.
