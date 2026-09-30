import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { requestPersistentStorage } from './utils/appStorage'
import { backendName } from './data/backend'
// Statically, not with import() inside boot(). Importing these dynamically made
// them initialise AFTER App's own static graph had begun, which changed module
// evaluation order enough to surface a cycle: the page died with "Cannot access
// 'N' before initialization" and rendered nothing. The app imports both of these
// from everywhere already, so importing them here adds no edge to the graph.
import { hydrateIfEmpty } from './data/hydrate'
import { repository } from './data/repository'

// Ask before the app writes anything: every board and every evaluation lives
// in localStorage, which a browser is otherwise free to evict under disk
// pressure. See appStorage.js — best effort, never blocks startup.
requestPersistentStorage()

// Sign in before the app asks anybody who they are.
//
// A viewer gets an anonymous session: it grants no write access — the rules
// refuse an anonymous provider — and it gives his play-along an identity of its
// own. An expert signs in properly from the UI and his writes start reaching
// the shared store, because `writesRemote` asks `isExpert()` on every write
// rather than capturing the answer once.
//
// Only a Firebase build calls this, and only a Firebase build imports the SDK:
// the app has to keep working with no backend at all, which is what every
// viewer building a private mock is doing.
if (backendName() === 'firebase') {
  // There used to be a retry here: openBoards() again on sign-in, because a
  // viewer arrives anonymous and the rules refuse an anonymous seed write, so
  // the seed was meant to land the moment somebody became an expert. A shared
  // database is not seeded from a browser at all now — openBoards() returns
  // immediately on a live backend — which made the retry a no-op wearing a
  // paragraph explaining what it used to do.
  //
  // Nothing replaces it. The tree renders without waiting for the session,
  // and the board list converges on its own when the session arrives: App
  // subscribes to onAuthChange, and the visibility filter asks about the
  // CURRENT identity rather than one captured at boot. That convergence is
  // asserted against the emulator — an expert signs in, does not reload, and
  // his board appears (tests/shared).
  import('./utils/auth')
    .then(({ startAuth }) => startAuth())
    .catch(err => console.warn('Could not start a session; continuing as a reader.', err?.code ?? err))
}

/**
 * A local store is filled from a pre-built snapshot BEFORE anything renders.
 *
 * This is the one thing worth holding the first paint for, and the reason is the
 * opposite of the reason auth is not: hydration decides what is in the store, and
 * every read after it is wrong if it has not finished. A view that mounts first
 * sees an empty store, and an empty store is what this app has historically
 * responded to by writing its own defaults. Auth only decides who you are, which
 * the app can converge on afterwards.
 *
 * It is a local file fetch into an empty store, so it is fast, and it does
 * nothing at all on a shared backend — that project is seeded from outside
 * before anybody signs in, and hydrate.js refuses a store it can watch.
 *
 * Never allowed to stop the app coming up: a build that ships no snapshot is a
 * legitimate build, and so is one whose snapshot cannot be read.
 */
async function boot() {
  try {
    const result = await hydrateIfEmpty(repository.adapter)
    if (result.hydrated) {
      console.info(`Loaded the shipped ${result.season?.year ?? ''} data: ${result.documents} documents.`)
      // The repository caches per collection, and hydration wrote underneath it.
      repository.invalidate()
    }
  } catch (err) {
    console.warn('Could not load the shipped data; starting empty.', err?.message ?? err)
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
