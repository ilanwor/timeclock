/**
 * src/rules/evaluator.js
 *
 * Priority-based rules evaluator.
 *
 * Settings are resolved in this order (each level overrides the previous):
 *   1. Global      — store_id=0, role_id=null, user_id=null
 *   2. Store       — store_id=X, role_id=null, user_id=null
 *   3. Role        — role_id=Y  (any store, no user)
 *   4. User        — user_id=Z  (any store / role)
 *
 * Exports:
 *   checkClockInAllowed(userId, storeId)    → { allowed, blocks, warnings }
 *   runAutoSignOutCheck()                   → autoSignedOut[]
 *   calculateShiftAdjustments(entryId)      → adjustment object
 */

import {
  startOfDay,
  startOfWeek,
  subDays,
  differenceInHours,
  differenceInMinutes,
} from 'date-fns'
import { db, writeAuditLog } from '../db/db'
import { routeAlert }        from '../alerts/alertRouter'

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded defaults — used when no setting exists at any priority level
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  rule_min_rest_hours:           '8',
  rule_min_rest_action:          'warn',
  rule_daily_hours_limit:        '12',
  rule_daily_hours_action:       'warn',
  overtime_threshold:            '40',
  rule_weekly_hours_action:      'warn',
  rule_max_consecutive_days:     '7',
  rule_consecutive_days_action:  'warn',
  max_shift_hours:               '12',
  rule_min_shift_minutes:        '0',
  break_required_after:          '6',
  paid_break_minutes:            '15',
  unpaid_break_minutes:          '30',
  rule_auto_signout_enabled:     'true',
  rule_auto_signout_hours:       '14',
  rule_auto_deduct_break:        'false',
  rule_time_rounding_minutes:    '0',
  rule_daily_ot_threshold:       '8',
  // Break compliance
  break_reminder_enabled:        'true',
  break_reminder_after_minutes:  '300',
  break_penalty_enabled:         'false',
  break_penalty_minutes:         '60',
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority-based rule loader
// ─────────────────────────────────────────────────────────────────────────────
export async function loadRulesForContext(userId, storeId, roleId) {
  const all = await db.settings.toArray()

  // Partition into priority layers (index = priority, higher = wins)
  const layers = [
    // 1 — Global
    all.filter(r => r.store_id === 0 && !r.role_id && !r.user_id),
    // 2 — Store-specific
    all.filter(r => r.store_id === storeId && !r.role_id && !r.user_id && storeId !== 0),
    // 3 — Role-specific (across any store)
    all.filter(r => r.role_id != null && r.role_id === roleId && !r.user_id),
    // 4 — User-specific (highest priority)
    all.filter(r => r.user_id != null && r.user_id === userId),
  ]

  // Merge layers — later entries win
  const merged = { ...DEFAULTS }
  for (const layer of layers) {
    for (const { key, value } of layer) {
      merged[key] = value
    }
  }
  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// checkClockInAllowed(userId, storeId)
//
// Returns { allowed: boolean, blocks: RuleResult[], warnings: RuleResult[] }
// A RuleResult is { code, title, message }
//
// blocks  → the action is forbidden; the employee cannot proceed
// warnings → the employee must acknowledge but may still proceed
// ─────────────────────────────────────────────────────────────────────────────
export async function checkClockInAllowed(userId, storeId) {
  const blocks   = []
  const warnings = []

  // ── Resolve user & rules ──────────────────────────────────────────────────
  const user = await db.users.get(userId)
  if (!user) {
    blocks.push({ code: 'user_not_found', title: 'User Not Found',
      message: 'No matching user account.' })
    return { allowed: false, blocks, warnings }
  }

  const rules = await loadRulesForContext(userId, storeId, user.role_id)
  const now   = new Date()

  function push(action, rule) {
    if (action === 'block') blocks.push(rule)
    else warnings.push(rule)
  }

  // ── Fetch all time entries for this user (one DB call) ────────────────────
  const allEntries = await db.time_entries
    .where('user_id').equals(userId)
    .toArray()

  const openEntry    = allEntries.find(e => !e.clock_out)
  const closedEntries = allEntries.filter(e => e.clock_out)

  // ── Rule 1: Already clocked in (hard block, no override) ─────────────────
  if (openEntry) {
    blocks.push({
      code:    'already_clocked_in',
      title:   'Already Clocked In',
      message: 'You are already clocked in. Please clock out first.',
    })
    return { allowed: false, blocks, warnings }
  }

  // ── Rule 2: Minimum rest period between shifts ────────────────────────────
  const minRestHours  = parseFloat(rules['rule_min_rest_hours'])
  const minRestAction = rules['rule_min_rest_action']
  if (minRestHours > 0 && closedEntries.length > 0) {
    const lastOut = closedEntries.reduce((latest, e) =>
      new Date(e.clock_out) > new Date(latest.clock_out) ? e : latest
    )
    const hoursRested = differenceInHours(now, new Date(lastOut.clock_out))
    if (hoursRested < minRestHours) {
      const remaining = (minRestHours - hoursRested).toFixed(1)
      push(minRestAction, {
        code:    'insufficient_rest',
        title:   'Minimum Rest Period',
        message: `You last clocked out ${hoursRested.toFixed(1)}h ago. `
               + `Minimum rest between shifts is ${minRestHours}h `
               + `(${remaining}h remaining).`,
      })
    }
  }

  // ── Rule 3: Daily hours limit ─────────────────────────────────────────────
  const dailyLimit  = parseFloat(rules['rule_daily_hours_limit'])
  const dailyAction = rules['rule_daily_hours_action']
  const todayStart  = startOfDay(now).toISOString()
  const todayMins   = closedEntries
    .filter(e => e.clock_in >= todayStart)
    .reduce((sum, e) => sum + (e.total_minutes ?? 0), 0)
  const todayHours  = todayMins / 60
  if (todayHours >= dailyLimit) {
    push(dailyAction, {
      code:    'daily_hours_limit',
      title:   'Daily Hours Limit',
      message: `You have already worked ${todayHours.toFixed(1)}h today `
             + `(limit: ${dailyLimit}h).`,
    })
  }

  // ── Rule 4: Weekly overtime warning ───────────────────────────────────────
  const weekThreshold = parseFloat(rules['overtime_threshold'])
  const weekAction    = rules['rule_weekly_hours_action']
  const weekStart     = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
  const weekMins      = closedEntries
    .filter(e => e.clock_in >= weekStart)
    .reduce((sum, e) => sum + (e.total_minutes ?? 0), 0)
  const weekHours     = weekMins / 60
  if (weekHours >= weekThreshold * 0.9) {
    const over = weekHours >= weekThreshold
    push(weekAction, {
      code:    'weekly_overtime',
      title:   over ? 'Overtime Exceeded' : 'Approaching Overtime',
      message: `You have worked ${weekHours.toFixed(1)}h this week `
             + `(${weekThreshold}h threshold). `
             + (over ? 'Clocking in will extend overtime.' : 'Clocking in will push you into overtime.'),
    })
  }

  // ── Rule 5: Maximum consecutive working days ──────────────────────────────
  const maxConsec    = parseInt(rules['rule_max_consecutive_days'], 10)
  const consecAction = rules['rule_consecutive_days_action']
  const lookbackStart = startOfDay(subDays(now, maxConsec + 1)).toISOString()
  const recentEntries = closedEntries.filter(e => e.clock_in >= lookbackStart)
  let consecDays = 0
  for (let i = 1; i <= maxConsec + 1; i++) {
    const dStart = startOfDay(subDays(now, i)).toISOString()
    const dEnd   = startOfDay(subDays(now, i - 1)).toISOString()
    const worked = recentEntries.some(e => e.clock_in >= dStart && e.clock_in < dEnd)
    if (worked) consecDays++
    else break
  }
  if (consecDays >= maxConsec) {
    push(consecAction, {
      code:    'consecutive_days',
      title:   'Consecutive Days Warning',
      message: `You have worked ${consecDays} consecutive day${consecDays !== 1 ? 's' : ''}. `
             + `Consider scheduling a rest day.`,
    })
  }

  return { allowed: blocks.length === 0, blocks, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// checkClockOutAllowed(userId, openEntry, storeId)
//
// Same structure as checkClockInAllowed but for clock-out.
// ─────────────────────────────────────────────────────────────────────────────
export async function checkClockOutAllowed(userId, openEntry, storeId) {
  const blocks   = []
  const warnings = []
  if (!openEntry) return { allowed: false, blocks: [{ code: 'not_clocked_in', title: 'Not Clocked In', message: 'No open shift found.' }], warnings }

  const user  = await db.users.get(userId)
  const rules = await loadRulesForContext(userId, storeId, user?.role_id)
  const now   = new Date()

  const minShiftMins = parseInt(rules['rule_min_shift_minutes'], 10)
  if (minShiftMins > 0) {
    const elapsed = differenceInMinutes(now, new Date(openEntry.clock_in))
    if (elapsed < minShiftMins) {
      warnings.push({
        code:    'short_shift',
        title:   'Short Shift',
        message: `You've only worked ${elapsed}m. Minimum shift is ${minShiftMins}m.`,
      })
    }
  }

  return { allowed: blocks.length === 0, blocks, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// runAutoSignOutCheck()
//
// Finds all open time entries that have exceeded rule_auto_signout_hours.
// Automatically closes them, ends any open breaks, and writes audit log.
//
// Safe to call on app startup and periodically (idempotent).
// Returns an array of { entry, user, autoClockOut, elapsedHours } records.
// ─────────────────────────────────────────────────────────────────────────────
export async function runAutoSignOutCheck() {
  const now         = new Date()
  const openEntries = await db.time_entries
    .filter(e => e.clock_out === null || e.clock_out === undefined)
    .toArray()

  if (!openEntries.length) return []

  const autoSigned = []

  for (const entry of openEntries) {
    const user  = await db.users.get(entry.user_id)
    const rules = await loadRulesForContext(entry.user_id, entry.store_id, user?.role_id)

    // Skip if auto sign-out is disabled for this context
    if (rules['rule_auto_signout_enabled'] === 'false') continue

    const maxHours    = parseFloat(rules['rule_auto_signout_hours'])
    const elapsedHours = differenceInHours(now, new Date(entry.clock_in))

    if (elapsedHours < maxHours) continue

    // Cap clock-out at clock_in + maxHours (don't use current time —
    // that would inflate hours if check runs much later than threshold)
    const autoClockOut   = new Date(new Date(entry.clock_in).getTime() + maxHours * 3_600_000)
    const totalMinutes   = Math.round(maxHours * 60)

    // Close any open breaks first
    const openBreaks = await db.breaks
      .where('time_entry_id').equals(entry.id)
      .filter(b => !b.break_end)
      .toArray()
    for (const brk of openBreaks) {
      const breakEnd     = autoClockOut.toISOString()
      const durationMins = Math.max(0, Math.round((autoClockOut - new Date(brk.break_start)) / 60_000))
      await db.breaks.update(brk.id, { break_end: breakEnd, duration_minutes: durationMins })
    }

    await db.time_entries.update(entry.id, {
      clock_out:     autoClockOut.toISOString(),
      total_minutes: totalMinutes,
      status:        'closed',
      notes:         `Auto signed out after ${maxHours}h — rule: rule_auto_signout_hours`,
      updated_at:    now.toISOString(),
    })

    await writeAuditLog({
      userId:     null,
      storeId:    entry.store_id,
      action:     'auto_signout',
      entityType: 'time_entry',
      entityId:   entry.id,
      oldValue:   { clock_out: null },
      newValue:   { clock_out: autoClockOut.toISOString(), reason: 'auto_signout_hours_exceeded' },
    })

    autoSigned.push({ entry, user, autoClockOut: autoClockOut.toISOString(), elapsedHours })

    // Notify managers at this store
    const employeeName = user ? `${user.first_name} ${user.last_name}` : `User #${entry.user_id}`
    await routeAlert({
      type:              'auto_signout',
      context:           {
        storeId:      entry.store_id,
        userId:       null,
        employeeName,
        maxHours,
        elapsedHours: elapsedHours.toFixed(1),
      },
      triggeringEntryId: entry.id,
    })
  }

  if (autoSigned.length) {
    console.info(`[AutoSignOut] Closed ${autoSigned.length} abandoned shift(s).`)
  }

  return autoSigned
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateShiftAdjustments(entryId)
//
// Given a time entry (open or closed), computes:
//   • Time rounding (clock_in / clock_out snapped to nearest N minutes)
//   • Break deductions (actual unpaid breaks + auto-deduct if no break taken)
//   • Net payable minutes (gross − unpaid deductions)
//   • Regular vs overtime minutes (daily OT threshold)
//
// Returns a rich adjustment object suitable for display in reports.
// ─────────────────────────────────────────────────────────────────────────────
export async function calculateShiftAdjustments(entryId) {
  const entry = await db.time_entries.get(entryId)
  if (!entry) throw new Error(`Time entry ${entryId} not found.`)

  const user   = await db.users.get(entry.user_id)
  const rules  = await loadRulesForContext(entry.user_id, entry.store_id, user?.role_id)
  const breaks = await db.breaks.where('time_entry_id').equals(entryId).toArray()

  const rawClockIn  = new Date(entry.clock_in)
  const rawClockOut = entry.clock_out ? new Date(entry.clock_out) : new Date()

  const adjustments = []   // human-readable log of what was changed

  // ── 1. Time rounding ──────────────────────────────────────────────────────
  const roundMins = parseInt(rules['rule_time_rounding_minutes'], 10)
  let adjIn  = rawClockIn
  let adjOut = rawClockOut

  if (roundMins > 0) {
    const roundMs = roundMins * 60_000
    // Clock-in rounds UP (employee charged for any partial interval they arrive in)
    const roundedIn  = new Date(Math.ceil(rawClockIn.getTime()  / roundMs) * roundMs)
    // Clock-out rounds DOWN (employee paid only for completed intervals)
    const roundedOut = new Date(Math.floor(rawClockOut.getTime() / roundMs) * roundMs)

    if (roundedIn.getTime() !== rawClockIn.getTime()) {
      const diff = Math.round((roundedIn - rawClockIn) / 60_000)
      adjustments.push({ type: 'rounding_in',  description: `Clock-in rounded up ${diff}m to nearest ${roundMins}m`, minutes: diff })
      adjIn = roundedIn
    }
    if (roundedOut.getTime() !== rawClockOut.getTime()) {
      const diff = Math.round((rawClockOut - roundedOut) / 60_000)
      adjustments.push({ type: 'rounding_out', description: `Clock-out rounded down ${diff}m to nearest ${roundMins}m`, minutes: -diff })
      adjOut = roundedOut
    }
  }

  // ── 2. Gross minutes ──────────────────────────────────────────────────────
  const grossMinutes = Math.max(0, Math.round((adjOut - adjIn) / 60_000))

  // ── 3. Break analysis ──────────────────────────────────────────────────────
  const closedBreaks     = breaks.filter(b => b.break_end)
  const paidBreakMins    = closedBreaks
    .filter(b => b.break_type === 'paid')
    .reduce((sum, b) => sum + (b.duration_minutes ?? 0), 0)
  const unpaidBreakMins  = closedBreaks
    .filter(b => b.break_type !== 'paid')
    .reduce((sum, b) => sum + (b.duration_minutes ?? 0), 0)

  // Auto-deduct: if employee worked >= break_required_after hours
  // and took no unpaid break, deduct the standard unpaid break length
  const breakRequiredAfter = parseFloat(rules['break_required_after'])
  const unpaidBreakLen     = parseInt(rules['unpaid_break_minutes'], 10)
  const autoDeductEnabled  = rules['rule_auto_deduct_break'] === 'true'
  let   autoDeductedMins   = 0

  const grossHours = grossMinutes / 60
  if (autoDeductEnabled && grossHours >= breakRequiredAfter && unpaidBreakMins === 0) {
    autoDeductedMins = unpaidBreakLen
    adjustments.push({
      type:        'auto_break_deduct',
      description: `Auto-deducted ${unpaidBreakLen}min unpaid break `
                 + `(worked ${grossHours.toFixed(1)}h, no break recorded)`,
      minutes:     -unpaidBreakLen,
    })
  }

  const totalUnpaidDeducted = unpaidBreakMins + autoDeductedMins

  // ── 4. Net payable minutes (before penalty) ───────────────────────────────
  const baseNetMinutes = Math.max(0, grossMinutes - totalUnpaidDeducted)

  // ── 4b. Break penalty ─────────────────────────────────────────────────────
  const penaltyMins = entry.penalty_minutes || 0
  if (penaltyMins > 0) {
    adjustments.push({
      type:        'break_penalty',
      description: `Break penalty: +${penaltyMins}m added for missed meal break`,
      minutes:     penaltyMins,
    })
  }
  const netMinutes = baseNetMinutes + penaltyMins

  // ── 5. Regular vs overtime (daily threshold) ──────────────────────────────
  const dailyOtThreshMins = parseFloat(rules['rule_daily_ot_threshold']) * 60
  const regularMinutes    = Math.min(netMinutes, dailyOtThreshMins)
  const overtimeMinutes   = Math.max(0, netMinutes - dailyOtThreshMins)

  if (overtimeMinutes > 0) {
    adjustments.push({
      type:        'overtime',
      description: `${overtimeMinutes}m classified as overtime `
                 + `(daily threshold: ${rules['rule_daily_ot_threshold']}h)`,
      minutes:     overtimeMinutes,
    })
  }

  return {
    entryId,

    // Raw (unmodified) timestamps
    rawClockIn:  entry.clock_in,
    rawClockOut: entry.clock_out ?? null,

    // Adjusted timestamps (after rounding)
    adjustedClockIn:  adjIn.toISOString(),
    adjustedClockOut: adjOut.toISOString(),

    // Breakdown
    grossMinutes,
    breakMinutes: {
      paid:         paidBreakMins,
      unpaid:       unpaidBreakMins,
      autoDeducted: autoDeductedMins,
      total:        paidBreakMins + unpaidBreakMins + autoDeductedMins,
    },
    deductedMinutes: totalUnpaidDeducted,
    penaltyMinutes:  penaltyMins,
    netMinutes,

    // Pay classification
    regularMinutes,
    overtimeMinutes,

    // Human-readable log of every adjustment applied
    adjustments,

    // The rule context used (useful for debugging / displaying to managers)
    appliedRules: {
      roundMins,
      breakRequiredAfter,
      unpaidBreakLen,
      autoDeductEnabled,
      dailyOtThresholdHours: parseFloat(rules['rule_daily_ot_threshold']),
    },
  }
}
