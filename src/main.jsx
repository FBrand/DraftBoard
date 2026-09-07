import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { requestPersistentStorage } from './utils/appStorage'

// Ask before the app writes anything: every board and every evaluation lives
// in localStorage, which a browser is otherwise free to evict under disk
// pressure. See appStorage.js — best effort, never blocks startup.
requestPersistentStorage()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
