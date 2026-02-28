import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { seedDatabase } from './db/db.js'
import { runAutoSignOutCheck } from './rules/evaluator.js'

// Seed first, then check for abandoned shifts, then render.
// Rendering only after the seed guarantees users/PINs exist on first load.
seedDatabase()
  .then(() => runAutoSignOutCheck())
  .catch(err => console.error('[Startup]', err))
  .finally(() => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })

// Re-run auto sign-out check every 30 minutes while app is open
setInterval(() => runAutoSignOutCheck().catch(console.error), 30 * 60 * 1000)
