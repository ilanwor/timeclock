import { db, writeAuditLog } from './db'

// ── Clock In ───────────────────────────────────────────────────────────────
export async function clockIn(userId, storeId) {
  const now = new Date().toISOString()
  const entryId = await db.time_entries.add({
    user_id:       userId,
    store_id:      storeId,
    clock_in:      now,
    clock_out:     null,
    total_minutes: null,
    status:        'open',
    notes:         null,
    created_at:    now,
    updated_at:    now,
  })
  await writeAuditLog({
    userId, storeId,
    action: 'clock_in', entityType: 'time_entry', entityId: entryId,
    newValue: { clock_in: now },
  })
  return entryId
}

// ── Clock Out ──────────────────────────────────────────────────────────────
export async function clockOut(entryId, userId, storeId) {
  const entry = await db.time_entries.get(entryId)
  if (!entry) throw new Error(`Time entry ${entryId} not found.`)
  const now     = new Date().toISOString()
  const minutes = Math.round((new Date(now) - new Date(entry.clock_in)) / 60000)

  // Close any open break first
  const openBreak = await db.breaks
    .where('time_entry_id').equals(entryId)
    .and(b => b.break_end === null)
    .first()
  if (openBreak) await endBreak(openBreak.id, userId, storeId)

  await db.time_entries.update(entryId, {
    clock_out:     now,
    total_minutes: minutes,
    status:        'closed',
    updated_at:    now,
  })
  await writeAuditLog({
    userId, storeId,
    action: 'clock_out', entityType: 'time_entry', entityId: entryId,
    oldValue: { clock_out: null },
    newValue: { clock_out: now, total_minutes: minutes },
  })
}

// ── Start Break ────────────────────────────────────────────────────────────
export async function startBreak(entryId, userId, breakType = 'unpaid') {
  const now     = new Date().toISOString()
  const breakId = await db.breaks.add({
    time_entry_id:    entryId,
    user_id:          userId,
    break_start:      now,
    break_end:        null,
    break_type:       breakType,
    duration_minutes: null,
    created_at:       now,
  })
  await writeAuditLog({
    userId, storeId: null,
    action: 'start_break', entityType: 'break', entityId: breakId,
    newValue: { break_start: now, break_type: breakType },
  })
  return breakId
}

// ── End Break ──────────────────────────────────────────────────────────────
export async function endBreak(breakId, userId, storeId) {
  const brk = await db.breaks.get(breakId)
  if (!brk) throw new Error(`Break ${breakId} not found.`)
  const now     = new Date().toISOString()
  const minutes = Math.round((new Date(now) - new Date(brk.break_start)) / 60000)

  await db.breaks.update(breakId, {
    break_end:        now,
    duration_minutes: minutes,
  })
  await writeAuditLog({
    userId, storeId,
    action: 'end_break', entityType: 'break', entityId: breakId,
    oldValue: { break_end: null },
    newValue: { break_end: now, duration_minutes: minutes },
  })
}
