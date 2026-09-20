import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { requestPersistentStorage } from './utils/appStorage'
import { backendName } from './data/backend'

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
  import('./utils/auth')
    .then(async ({ startAuth, onAuthChange, isExpert }) => {
      await startAuth()

      // openBoards() runs once at boot, before sign-in has necessarily
      // finished — a viewer arrives anonymous, and firestore.rules refuse an
      // anonymous seed write. Retrying it here means signing in makes the
      // seed land without needing a reload; openBoards() itself is the thing
      // that decides "not yet initialized" (no boards found) and is a no-op
      // once they exist, so calling it again on an already-seeded project
      // costs nothing.
      onAuthChange(() => {
        if (!isExpert()) return
        import('./utils/boardRegistry')
          .then(({ openBoards }) => openBoards())
          .catch(err => console.warn('Could not seed the shared board records.', err?.code ?? err))
      })
    })
    .catch(err => console.warn('Could not start a session; continuing as a reader.', err?.code ?? err))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
