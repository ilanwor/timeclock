/**
 * Notification / Alert helpers
 *
 * Two systems coexist:
 *  1. Legacy alerts  — created by managers, stored in `alerts` table.
 *  2. Structured notifications — admin-configured templates in `notifications`
 *     table; shown at specific trigger events with questions + conditional actions.
 */

import { db, writeAuditLog } from '../db/db'

// ── Shift review helpers ───────────────────────────────────────────────────

/**
 * Returns time entries with edit_status === 'pending_review' for this employee,
 * enriched with the editor's user record for display in ShiftReviewView.
 */
export async function getPendingShiftReviews(userId) {
  const entries = await db.time_entries
    .where('user_id').equals(userId)
    .filter(e => e.edit_status === 'pending_review')
    .toArray()

  if (!entries.length) return []

  const editorIds   = [...new Set(entries.map(e => e.edited_by_user_id).filter(Boolean))]
  const editors     = await Promise.all(editorIds.map(id => db.users.get(id)))
  const editorsById = Object.fromEntries(editors.filter(Boolean).map(e => [e.id, e]))

  return entries.map(e => ({ ...e, editor: editorsById[e.edited_by_user_id] ?? null }))
}

// ── Legacy alert helpers ───────────────────────────────────────────────────

/**
 * Returns pending legacy alerts split into:
 *  notifications : general info / warnings / questions
 *  shiftEdits    : type === 'shift_edit'
 */
export async function getPendingAlerts(userId, roleId, storeId) {
  const now = new Date().toISOString()

  const allAlerts = await db.alerts
    .where('store_id').equals(storeId)
    .filter(a => {
      if (a.expires_at && a.expires_at < now) return false
      if (a.target_user_id != null) return a.target_user_id === userId
      if (a.target_role_id != null) return a.target_role_id === roleId
      return true
    })
    .toArray()

  if (!allAlerts.length) return { notifications: [], shiftEdits: [] }

  const responses    = await db.notification_responses.where('user_id').equals(userId).toArray()
  const respondedIds = new Set(responses.filter(r => r.alert_id != null).map(r => r.alert_id))
  const pending      = allAlerts.filter(a => !respondedIds.has(a.id))

  // shift_edit_pending / shift_edit_disputed are handled via the shift_review step
  // (driven by time_entries directly) or the admin inbox — not the kiosk notification flow.
  const REVIEW_TYPES = new Set(['shift_edit_pending', 'shift_edit_disputed'])
  return {
    notifications: pending.filter(a => a.type !== 'shift_edit' && !REVIEW_TYPES.has(a.type)),
    shiftEdits:    pending.filter(a => a.type === 'shift_edit'),
  }
}

/** Records an employee's response to a legacy alert and marks it read. */
export async function respondToAlert(alertId, userId, response) {
  await db.notification_responses.add({
    alert_id:     alertId,
    user_id:      userId,
    response,
    responded_at: new Date().toISOString(),
  })
  await db.alerts.update(alertId, { is_read: 1 })
}

// ── Structured notification helpers ───────────────────────────────────────

/**
 * Returns structured notification templates that should be shown to this user
 * for the given trigger event, filtered by scope and repeat policy.
 */
export async function getActiveNotificationsForTrigger(userId, roleId, storeId, triggerEvent) {
  const now = new Date().toISOString()

  const all = await db.notifications
    .where('trigger_event').equals(triggerEvent)
    .filter(n => {
      if (!n.is_active) return false
      if (n.expires_at && n.expires_at < now) return false
      if (n.scope_type === 'all')   return true
      if (n.scope_type === 'store') return n.scope_id === storeId
      if (n.scope_type === 'role')  return n.scope_id === roleId
      if (n.scope_type === 'user')  return n.scope_id === userId
      return false
    })
    .toArray()

  if (!all.length) return []

  // Filter by repeat policy against this user's prior responses
  const responses      = await db.notification_responses.where('user_id').equals(userId).toArray()
  const notifResponses = responses.filter(r => r.notification_id != null)
  const today          = new Date().toDateString()

  return all.filter(n => {
    if (n.repeat_type === 'always') return true
    const seen = notifResponses.filter(r => r.notification_id === n.id)
    if (!seen.length) return true
    if (n.repeat_type === 'once') return false
    if (n.repeat_type === 'daily') {
      const last = seen.reduce((a, b) => a.responded_at > b.responded_at ? a : b)
      return new Date(last.responded_at).toDateString() !== today
    }
    return false
  })
}

// ── Conditional action evaluator ──────────────────────────────────────────

function testCondition(condition, answers) {
  if (!condition) return true  // no condition = always fires
  const answer = answers[condition.question_id]
  switch (condition.operator) {
    case 'answered':   return answer !== undefined && answer !== ''
    case 'equals':     return String(answer) === String(condition.value)
    case 'not_equals': return String(answer) !== String(condition.value)
    case 'contains':   return String(answer || '').toLowerCase()
                              .includes(String(condition.value).toLowerCase())
    default:           return false
  }
}

/**
 * Evaluates conditional actions against collected answers.
 * Returns an array of fired action results.
 * Block results: { type: 'block', message } — ClockFlow handles these.
 */
async function evaluateConditionalActions(notification, answers, userId, storeId, timeEntryId) {
  const actions = JSON.parse(notification.conditional_actions || '[]')
  const fired   = []

  for (const ca of actions) {
    if (!testCondition(ca.condition, answers)) continue

    if (ca.action_type === 'block') {
      fired.push({ type: 'block', message: ca.action_data?.message || 'Action blocked by policy' })

    } else if (ca.action_type === 'create_alert') {
      const now = new Date().toISOString()
      await db.alerts.add({
        store_id:           storeId,
        created_by_user_id: null,
        target_role_id:     ca.action_data?.target_role_id ?? null,
        target_user_id:     ca.action_data?.target_user_id ?? null,
        type:               ca.action_data?.alert_type || 'info',
        title:              ca.action_data?.title || notification.title,
        message:            ca.action_data?.message || JSON.stringify(answers),
        is_read:            0,
        created_at:         now,
        expires_at:         null,
      })
      fired.push({ type: 'create_alert' })

    } else if (ca.action_type === 'add_note') {
      if (timeEntryId) {
        const entry = await db.time_entries.get(timeEntryId)
        if (entry) {
          const prefix   = entry.notes ? entry.notes + '\n' : ''
          const noteText = `[${notification.title}] ${JSON.stringify(answers)}`
          await db.time_entries.update(timeEntryId, { notes: prefix + noteText })
        }
      }
      fired.push({ type: 'add_note' })

    } else if (ca.action_type === 'flag_entry') {
      if (timeEntryId) await db.time_entries.update(timeEntryId, { is_flagged: 1 })
      fired.push({ type: 'flag_entry' })

    } else if (ca.action_type === 'require_approval') {
      if (timeEntryId) await db.time_entries.update(timeEntryId, { status: 'disputed', requires_approval: 1 })
      fired.push({ type: 'require_approval' })
    }
  }

  return fired
}

/**
 * Saves a structured notification response, fires conditional actions, and
 * writes an audit log entry.
 * Returns array of action results (includes any { type: 'block' } entries).
 */
export async function saveNotificationResponse(notification, userId, storeId, timeEntryId, answers) {
  const actionResults = await evaluateConditionalActions(
    notification, answers, userId, storeId, timeEntryId
  )

  await db.notification_responses.add({
    alert_id:        null,
    notification_id: notification.id,
    user_id:         userId,
    time_entry_id:   timeEntryId ?? null,
    answers:         JSON.stringify(answers),
    actions_fired:   JSON.stringify(actionResults),
    responded_at:    new Date().toISOString(),
  })

  await writeAuditLog({
    userId,
    storeId,
    action:     'notification_response',
    entityType: 'notification',
    entityId:   notification.id,
    newValue:   { answers, actionResults },
  })

  return actionResults
}
