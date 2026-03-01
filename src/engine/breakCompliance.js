/**
 * src/engine/breakCompliance.js
 *
 * Break compliance helpers:
 *  checkBreakStatus  — determines whether a reminder / ack is needed for a shift
 *  applyBreakPenalty — adds penalty_minutes to a time entry + writes audit log
 */

import { db } from '../db/db'
import { loadRulesForContext } from '../rules/evaluator'
import { routeAlert } from '../alerts/alertRouter'

/**
 * Checks break compliance state for a given open shift.
 *
 * shouldRemindBreak — global + user reminder on, shift >= threshold, no break taken
 * needsBreakAck     — shift long enough (>= break_required_after), no break taken
 *                     (independent of the reminder toggle; applies to all employees)
 * hasBreak          — whether any completed break exists for this shift
 * penaltyEnabled    — whether the missed-break penalty rule is active
 * penaltyMinutes    — minutes to add as penalty
 * shiftMinutes      — current open-shift duration in minutes
 */
export async function checkBreakStatus(openEntry, storeId, user) {
  const empty = {
    shouldRemindBreak: false,
    needsBreakAck:     false,
    hasBreak:          false,
    penaltyEnabled:    false,
    penaltyMinutes:    60,
    shiftMinutes:      0,
    minBreakRemaining: 0,
  }
  if (!openEntry) return empty

  const rules  = await loadRulesForContext(user.id, storeId, user.role_id)
  const breaks = await db.breaks.where('time_entry_id').equals(openEntry.id).toArray()
  const hasBreak      = breaks.some(b => b.break_end != null)
  const openBreakRec  = breaks.find(b => b.break_end === null)

  const shiftMinutes = (Date.now() - new Date(openEntry.clock_in).getTime()) / 60_000

  // ── Reminder (in-shift nudge) ──────────────────────────────────────────
  const globalReminderOn  = rules['break_reminder_enabled'] !== 'false'
  const userReminderOn    = user.break_reminder_enabled !== 0 // undefined → true (default on)
  const reminderAfterMins = parseFloat(rules['break_reminder_after_minutes'] || '300')
  const shouldRemindBreak = globalReminderOn && userReminderOn
    && shiftMinutes >= reminderAfterMins
    && !hasBreak

  // ── Clock-out acknowledgment (compliance gate) ─────────────────────────
  const requiredAfterHours = parseFloat(rules['break_required_after'] || '6')
  const needsBreakAck      = requiredAfterHours > 0
    && shiftMinutes >= requiredAfterHours * 60
    && !hasBreak

  // ── Penalty settings ───────────────────────────────────────────────────
  const penaltyEnabled = rules['break_penalty_enabled'] === 'true'
  const penaltyMinutes = parseInt(rules['break_penalty_minutes'] || '60', 10)

  // ── Minimum break duration (employee cannot end break early) ───────────
  const minBreakMins = parseInt(rules['unpaid_break_minutes'] || '30', 10)
  let minBreakRemaining = 0
  if (openBreakRec) {
    const elapsedBreakMins = (Date.now() - new Date(openBreakRec.break_start).getTime()) / 60_000
    minBreakRemaining = Math.max(0, Math.ceil(minBreakMins - elapsedBreakMins))
  }

  return { shouldRemindBreak, needsBreakAck, hasBreak, penaltyEnabled, penaltyMinutes, shiftMinutes, minBreakRemaining }
}

/**
 * Adds penaltyMinutes to the time entry's penalty_minutes field
 * and writes an immutable audit log entry.
 */
export async function applyBreakPenalty(timeEntry, userId, storeId, penaltyMinutes) {
  const now             = new Date().toISOString()
  const existingPenalty = timeEntry.penalty_minutes || 0
  const newPenalty      = existingPenalty + penaltyMinutes

  await db.time_entries.update(timeEntry.id, {
    penalty_minutes: newPenalty,
    updated_at:      now,
  })

  await db.audit_log.add({
    user_id:     userId,
    store_id:    storeId,
    action:      'break_penalty_applied',
    entity_type: 'time_entry',
    entity_id:   timeEntry.id,
    old_value:   JSON.stringify({ penalty_minutes: existingPenalty }),
    new_value:   JSON.stringify({ penalty_minutes: newPenalty, reason: 'missed_meal_break' }),
    ip_address:  null,
    created_at:  now,
  })

  // Route alert to managers / super admins at this store
  const user         = await db.users.get(userId)
  const employeeName = user ? `${user.first_name} ${user.last_name}` : `User #${userId}`
  await routeAlert({
    type:              'break_penalty_applied',
    context:           { storeId, userId, employeeName, penaltyMinutes },
    triggeringEntryId: timeEntry.id,
  })

  return newPenalty
}
