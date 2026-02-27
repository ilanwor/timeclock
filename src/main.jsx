import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { seedDatabase } from './db/db.js'
import { runAutoSignOutCheck } from './rules/evaluator.js'

// Seed on first run, then immediately check for abandoned open shifts
seedDatabase()
  .then(() => runAutoSignOutCheck())
  .catch(console.error)

// Re-run auto sign-out check every 30 minutes while app is open
setInterval(() => runAutoSignOutCheck().catch(console.error), 30 * 60 * 1000)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
