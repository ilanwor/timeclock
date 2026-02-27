/**
 * src/alerts/alertRouter.js
 *
 * Routes alert events to eligible recipients at the triggering store.
 *
 * Phase 1  — in-app inbox: writes one `alerts` row per recipient so each
 *             manager/admin sees it in their personal inbox.
 * Phase 2  — external channels (email / SMS): intentional no-op stubs.
 *             Browser apps cannot securely hold API keys; replace the stubs
 *             with fetch() calls to your backend proxy when ready.
 *             See comments inside sendViaEmail / sendViaSms for the payload
 *             shape expected by SendGrid / Twilio.
 *
 * Recipient eligibility
 * ─────────────────────
 * A user receives an alert when ALL of these hold:
 *   1. They are active (is_active = 1).
 *   2. They are assigned to the same store as the triggering event.
 *   3. Their role's permissions JSON contains the key required by the alert
 *      type with value === true.
 *
 *      The spec calls this "role.can_receive_alerts". It maps to existing
 *      permission flags already on each role:
 *        • manage_alerts: true  → Super Admin, Manager  (default for system alerts)
 *        • respond_to_alerts: true → all roles  (use for employee-visible alerts)
 *
 * Usage
 * ─────
 *   import { routeAlert } from '../alerts/alertRouter'
 *   await routeAlert({
 *     type:              'auto_signout',
 *     context:           { storeId, employeeName, maxHours },
 *     triggeringEntryId: entry.id,
 *   })
 */

import { db, writeAuditLog } from '../db/db'

// ── Alert type registry ────────────────────────────────────────────────────
// Add new event types here. Each entry defines:
//   type               — alerts.type value (info | warning | urgent)
//   requiredPermission — role.permissions key that must be true to receive this alert
//   title(ctx)         — function returning the alert title string
//   message(ctx)       — function returning the alert body string
//   ctx fields are whatever the caller passes in event.context

export const ALERT_TYPES = {
  // Employee clocked out without taking a required meal break (no penalty)
  missed_break: {
    type:               'warning',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Missed Break — ${ctx.employeeName}`,
    message: ctx => {
      const shiftStr = ctx.shiftMinutes != null
        ? ` after a ${(ctx.shiftMinutes / 60).toFixed(1)}h shift`
        : ''
      return `${ctx.employeeName} clocked out without taking a meal break${shiftStr}.`
    },
  },

  // Penalty minutes were added to the shift (missed break + penalty rule enabled)
  break_penalty_applied: {
    type:               'warning',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Break Penalty — ${ctx.employeeName}`,
    message: ctx =>
      `${ctx.penaltyMinutes}min penalty applied to ${ctx.employeeName}'s shift for a missed meal break.`,
  },

  // System automatically closed an open shift that exceeded the threshold
  auto_signout: {
    type:               'info',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Auto Sign-Out — ${ctx.employeeName}`,
    message: ctx =>
      `${ctx.employeeName} was automatically signed out after ${ctx.maxHours}h ` +
      `(actual elapsed: ${ctx.elapsedHours}h).`,
  },

  // Generic rule violation (clock-in blocked or warned)
  rule_violation: {
    type:               'warning',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Rule Violation — ${ctx.employeeName}`,
    message: ctx => ctx.details || `A scheduling rule was violated for ${ctx.employeeName}.`,
  },

  // Employee approaching or over the weekly overtime threshold
  overtime_warning: {
    type:               'warning',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Overtime Warning — ${ctx.employeeName}`,
    message: ctx =>
      `${ctx.employeeName} has worked ${Number(ctx.weeklyHours).toFixed(1)}h this week` +
      (ctx.threshold ? ` (${ctx.threshold}h threshold)` : '') + '.',
  },

  // Clock-in was hard-blocked; a manager must approve before the employee can proceed
  manager_override_required: {
    type:               'urgent',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Override Required — ${ctx.employeeName}`,
    message: ctx =>
      `${ctx.employeeName} was blocked at clock-in. Manager override required. ` +
      `Reason: ${ctx.reason || 'policy rule block'}.`,
  },

  // Employee clocked out unusually quickly (below minimum shift duration)
  short_shift: {
    type:               'info',
    requiredPermission: 'manage_alerts',
    title:   ctx => `Short Shift — ${ctx.employeeName}`,
    message: ctx =>
      `${ctx.employeeName} clocked out after only ${ctx.shiftMinutes} minutes.`,
  },
}

// ── Recipient resolution ───────────────────────────────────────────────────
/**
 * Returns active users at `storeId` whose role permissions contain
 * `{ [requiredPermission]: true }`.
 *
 * This is the canonical implementation of "role.can_receive_alerts AND store
 * match" from the spec. The requiredPermission varies per alert type so that,
 * for example, operational alerts go only to managers while employee-facing
 * alerts (future use) could use respond_to_alerts.
 */
async function resolveRecipients(storeId, requiredPermission) {
  const storeUsers = await db.users
    .where('store_id').equals(storeId)
    .and(u => u.is_active === 1)
    .toArray()

  if (!storeUsers.length) return []

  const roleIds   = [...new Set(storeUsers.map(u => u.role_id).filter(Boolean))]
  const roles     = await db.roles.where('id').anyOf(roleIds).toArray()
  const rolesById = Object.fromEntries(roles.map(r => [r.id, r]))

  return storeUsers.filter(u => {
    const role = rolesById[u.role_id]
    if (!role) return false
    let perms = {}
    try { perms = JSON.parse(role.permissions || '{}') } catch { return false }
    return perms[requiredPermission] === true
  })
}

// ── In-app alert creation ──────────────────────────────────────────────────
/**
 * Inserts one `alerts` row per recipient.
 * Using target_user_id (not target_role_id) so each user gets a clean per-user
 * inbox view and can mark their own copy read independently.
 */
async function createInAppAlerts(recipients, alertDef, context, triggeringEntryId) {
  const now = new Date().toISOString()
  const ids = []

  for (const user of recipients) {
    const id = await db.alerts.add({
      store_id:            context.storeId,
      created_by_user_id:  null,            // null = system-generated
      target_role_id:      null,
      target_user_id:      user.id,
      type:                alertDef.type,
      title:               alertDef.title(context),
      message:             alertDef.message(context),
      is_read:             0,
      triggering_entry_id: triggeringEntryId ?? null,
      created_at:          now,
      expires_at:          null,
    })
    ids.push(id)
  }

  return ids
}

// ── Phase 2: External channel stubs ───────────────────────────────────────
//
// WHY STUBS: Browser apps cannot safely embed secret API keys. These functions
// are designed to be replaced with fetch() calls to a backend proxy endpoint
// (e.g. a Cloudflare Worker, Express route, or serverless function) that holds
// the credentials server-side.
//
// HOW TO ACTIVATE:
//   1. Build a backend endpoint (e.g. POST /api/send-email).
//   2. Set alert_channel_email / alert_channel_sms to 'true' in Admin → Settings.
//   3. Replace the console.info lines below with the corresponding fetch() call.

/**
 * Phase 2 stub — Email via SendGrid.
 *
 * Backend endpoint payload:
 *   POST /api/send-email
 *   { to: string, subject: string, body: string }
 *
 * Backend implementation (server-side, never in browser):
 *   const sgMail = require('@sendgrid/mail')
 *   sgMail.setApiKey(process.env.SENDGRID_API_KEY)
 *   await sgMail.send({ to, from: process.env.SENDGRID_FROM, subject, text: body })
 */
async function sendViaEmail(recipients, alertDef, context) {
  const subject = alertDef.title(context)
  const body    = alertDef.message(context)

  for (const user of recipients) {
    if (!user.email) continue
    console.info('[AlertRouter][Phase2-Email]', {
      to: user.email,
      subject,
      body,
      // TODO: replace with →
      // await fetch('/api/send-email', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ to: user.email, subject, body }),
      // })
    })
  }
}

/**
 * Phase 2 stub — SMS via Twilio.
 *
 * Prerequisite: add a `phone` column to the users table and populate it.
 *
 * Backend endpoint payload:
 *   POST /api/send-sms
 *   { to: string, body: string }
 *
 * Backend implementation (server-side, never in browser):
 *   const twilio = require('twilio')
 *   const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
 *   await client.messages.create({ to, from: process.env.TWILIO_FROM, body })
 */
async function sendViaSms(recipients, alertDef, context) {
  const body = `[TimeClock] ${alertDef.title(context)}: ${alertDef.message(context)}`

  for (const user of recipients) {
    if (!user.phone) continue
    console.info('[AlertRouter][Phase2-SMS]', {
      to: user.phone,
      body,
      // TODO: replace with →
      // await fetch('/api/send-sms', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ to: user.phone, body }),
      // })
    })
  }
}

// ── Active channel resolver ────────────────────────────────────────────────
// Reads from the settings table (store_id = 0 / global) so admins can flip
// channels via Admin → Settings without touching code.
async function activeChannels() {
  const rows = await db.settings
    .where('[store_id+key]')
    .anyOf([
      [0, 'alert_channel_email'],
      [0, 'alert_channel_sms'],
    ])
    .toArray()

  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    email: map['alert_channel_email'] === 'true',
    sms:   map['alert_channel_sms']   === 'true',
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Route an alert event to all eligible recipients at the triggering store.
 *
 * Always writes in-app inbox rows (Phase 1).
 * Conditionally dispatches external channels based on settings (Phase 2 stubs).
 * Always writes an audit_log entry.
 *
 * @param {object}  event
 * @param {string}  event.type                - Key from ALERT_TYPES
 * @param {object}  event.context             - { storeId, employeeName, ...type-specific }
 * @param {number} [event.triggeringEntryId]  - time_entries.id that caused the event
 *
 * @returns {Promise<{ recipientCount: number, alertIds: number[], channels: string[] }>}
 */
export async function routeAlert({ type, context, triggeringEntryId }) {
  const alertDef = ALERT_TYPES[type]
  if (!alertDef) {
    console.warn(`[AlertRouter] Unknown type "${type}". No alert sent.`)
    return { recipientCount: 0, alertIds: [], channels: [] }
  }

  if (!context?.storeId) {
    console.warn(`[AlertRouter] Missing context.storeId for type "${type}". No alert sent.`)
    return { recipientCount: 0, alertIds: [], channels: [] }
  }

  const recipients = await resolveRecipients(context.storeId, alertDef.requiredPermission)
  if (!recipients.length) {
    return { recipientCount: 0, alertIds: [], channels: [] }
  }

  const channels = []

  // Phase 1: in-app inbox
  const alertIds = await createInAppAlerts(recipients, alertDef, context, triggeringEntryId)
  channels.push('in_app')

  // Phase 2: external channels (stubs — activated via settings)
  const ext = await activeChannels()
  if (ext.email) { await sendViaEmail(recipients, alertDef, context); channels.push('email') }
  if (ext.sms)   { await sendViaSms(recipients,  alertDef, context); channels.push('sms')   }

  // Audit trail
  await writeAuditLog({
    userId:     context.userId ?? null,
    storeId:    context.storeId,
    action:     'alert_routed',
    entityType: 'alert',
    entityId:   triggeringEntryId ?? null,
    newValue:   { type, alertIds, recipientCount: recipients.length, channels },
  })

  return { recipientCount: recipients.length, alertIds, channels }
}
