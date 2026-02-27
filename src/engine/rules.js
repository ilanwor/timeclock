/**
 * src/engine/rules.js
 *
 * Adapter layer — wraps the priority-based evaluator in the array-of-results
 * format expected by ClockFlow.jsx.
 *
 * ClockFlow receives:  Array<{ type: 'block'|'warn', code, title, message }>
 * Evaluator returns:   { allowed, blocks: [...], warnings: [...] }
 */

import { checkClockInAllowed, checkClockOutAllowed } from '../rules/evaluator'

// Convert evaluator output → flat array with type field
function flatten({ blocks, warnings }) {
  return [
    ...blocks.map(r   => ({ type: 'block', ...r })),
    ...warnings.map(r => ({ type: 'warn',  ...r })),
  ]
}

/** Called by ClockFlow before a clock-in action. */
export async function runClockInRules(user, storeId) {
  const result = await checkClockInAllowed(user.id, storeId)
  return flatten(result)
}

/** Called by ClockFlow before a clock-out action. */
export async function runClockOutRules(user, openEntry, storeId) {
  const result = await checkClockOutAllowed(user.id, openEntry, storeId)
  return flatten(result)
}
