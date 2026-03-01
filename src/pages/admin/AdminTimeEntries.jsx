/**
 * AdminTimeEntries — view and edit employee clock-in/out records.
 *
 * Access: gated by edit_any_time permission (set in Admin → Roles).
 * Edited entries are highlighted blue and flagged with an edit_status badge.
 * Saving an edit sets edit_status = 'pending_review' and notifies the employee.
 */

import { useState, useEffect, useCallback } from 'react'
import { format, parseISO }                 from 'date-fns'
import { db, writeAuditLog }               from '../../db/db'
import { useAuth }                         from '../../context/AuthContext'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDT(iso) {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'MMM d, yyyy h:mm a') }
  catch { return iso }
}

function toInputDT(iso) {
  if (!iso) return ''
  try { return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm") }
  catch { return '' }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function EditStatusBadge({ status }) {
  if (!status) return null
  const styles = {
    pending_review: 'bg-blue-500/20 text-blue-400',
    approved:       'bg-emerald-500/20 text-emerald-400',
    disputed:       'bg-red-500/20 text-red-400',
  }
  const labels = {
    pending_review: 'Pending Review',
    approved:       'Approved',
    disputed:       'Disputed',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || 'bg-slate-700 text-slate-400'}`}>
      {labels[status] || status}
    </span>
  )
}

function TH({ children }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap text-left">
      {children}
    </th>
  )
}

function TD({ children, mono, accent }) {
  return (
    <td className={`px-4 py-3 text-sm border-t border-slate-800 ${mono ? 'font-mono tabular-nums' : ''} ${accent || 'text-slate-300'}`}>
      {children}
    </td>
  )
}

const selectCls = `bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm
  focus:outline-none focus:border-blue-500 transition-colors`

const inputCls = `w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm
  focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors
  disabled:opacity-50 disabled:cursor-not-allowed`

// ── Main component ─────────────────────────────────────────────────────────

export default function AdminTimeEntries() {
  const { user: me } = useAuth()
  const canEdit = me?.permissions?.edit_any_time

  const [entries,     setEntries]     = useState([])
  const [users,       setUsers]       = useState([])
  const [stores,      setStores]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [filterUser,  setFilterUser]  = useState('all')
  const [filterStore, setFilterStore] = useState('all')
  const [editing,     setEditing]     = useState(null)   // { entry, entryUser, form }
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')

  // ── Data loading ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [allEntries, allUsers, allStores] = await Promise.all([
        db.time_entries.orderBy('clock_in').reverse().toArray(),
        db.users.toArray(),
        db.stores.toArray(),
      ])
      setEntries(allEntries)
      setUsers(allUsers)
      setStores(allStores)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const usersById  = Object.fromEntries(users.map(u => [u.id, u]))
  const storesById = Object.fromEntries(stores.map(s => [s.id, s]))

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = entries.filter(e => {
    if (filterUser  !== 'all' && e.user_id  !== parseInt(filterUser,  10)) return false
    if (filterStore !== 'all' && e.store_id !== parseInt(filterStore, 10)) return false
    return true
  })

  // ── Edit modal ────────────────────────────────────────────────────────────
  function openEdit(entry) {
    setErr('')
    setEditing({
      entry,
      entryUser: usersById[entry.user_id] ?? null,
      form: {
        clock_in:   toInputDT(entry.clock_in),
        clock_out:  toInputDT(entry.clock_out),
        edit_notes: entry.edit_notes || '',
      },
    })
  }

  async function handleSave() {
    if (!editing) return
    const { entry, form } = editing
    setErr('')

    if (!form.clock_in) { setErr('Clock-in time is required.'); return }

    const newClockIn  = new Date(form.clock_in).toISOString()
    const newClockOut = form.clock_out ? new Date(form.clock_out).toISOString() : null

    if (newClockOut && newClockOut <= newClockIn) {
      setErr('Clock-out must be after clock-in.')
      return
    }

    setSaving(true)
    try {
      const now = new Date().toISOString()

      const updates = {
        clock_in:          newClockIn,
        edit_status:       'pending_review',
        edited_by_user_id: me.id,
        edited_at:         now,
        edit_notes:        form.edit_notes || null,
        updated_at:        now,
      }

      if (newClockOut) {
        updates.clock_out      = newClockOut
        updates.total_minutes  = Math.round((new Date(newClockOut) - new Date(newClockIn)) / 60000)
      }

      // Snapshot original times on first edit only
      if (!entry.original_clock_in) {
        updates.original_clock_in  = entry.clock_in
        updates.original_clock_out = entry.clock_out ?? null
      }

      await db.time_entries.update(entry.id, updates)

      // Mark any old pending-review alert for this entry as read
      const oldAlerts = await db.alerts
        .filter(a => a.type === 'shift_edit_pending' && a.entity_id === entry.id && !a.is_read)
        .toArray()
      await Promise.all(oldAlerts.map(a => db.alerts.update(a.id, { is_read: 1 })))

      // Notify the employee
      const editDate = format(parseISO(newClockIn), 'MMM d, yyyy')
      const timeStr  = `${format(parseISO(newClockIn), 'h:mm a')}${newClockOut ? ` – ${format(parseISO(newClockOut), 'h:mm a')}` : ' (open)'}`
      await db.alerts.add({
        store_id:           entry.store_id,
        created_by_user_id: me.id,
        target_role_id:     null,
        target_user_id:     entry.user_id,
        type:               'shift_edit_pending',
        title:              'Shift Edited — Review Required',
        message:            `Your shift on ${editDate} was edited by ${me.first_name} ${me.last_name}. ` +
                            `New time: ${timeStr}.` +
                            (form.edit_notes ? ` Note: ${form.edit_notes}` : ''),
        is_read:            0,
        entity_id:          entry.id,
        created_at:         now,
        expires_at:         null,
      })

      await writeAuditLog({
        userId:     me.id,
        storeId:    entry.store_id,
        action:     'edit_time_entry',
        entityType: 'time_entry',
        entityId:   entry.id,
        oldValue:   { clock_in: entry.clock_in, clock_out: entry.clock_out },
        newValue:   { clock_in: newClockIn, clock_out: newClockOut, edit_notes: form.edit_notes },
      })

      setEditing(null)
      await load()
    } catch (e) {
      setErr('Save failed: ' + (e.message || String(e)))
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Time Entries</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          View and edit employee clock-in / clock-out records.
          {canEdit ? '' : ' (Read-only — edit_any_time permission required)'}
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-blue-500/60" />
          <span className="text-xs text-slate-400">Edited shift</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-6 flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Employee</label>
          <select className={selectCls} value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            <option value="all">All Employees</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Store</label>
          <select className={selectCls} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="all">All Stores</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="self-end">
          <button
            onClick={load}
            className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-slate-500 text-center py-12">No time entries found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50">
                <tr>
                  <TH>Employee</TH>
                  <TH>Clock In</TH>
                  <TH>Clock Out</TH>
                  <TH>Status</TH>
                  <TH>Edit Status</TH>
                  {canEdit && <TH>Actions</TH>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const u        = usersById[e.user_id]
                  const isEdited = e.edit_status != null
                  return (
                    <tr
                      key={e.id}
                      className={`transition-colors ${
                        isEdited ? 'bg-blue-900/20 hover:bg-blue-900/30' : 'hover:bg-slate-700/30'
                      }`}
                    >
                      <TD>{u ? `${u.first_name} ${u.last_name}` : `User #${e.user_id}`}</TD>
                      <TD mono>{fmtDT(e.clock_in)}</TD>
                      <TD mono accent={!e.clock_out ? 'text-amber-400' : 'text-slate-300'}>
                        {e.clock_out ? fmtDT(e.clock_out) : 'Open'}
                      </TD>
                      <TD>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          e.clock_out
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {e.clock_out ? 'Completed' : 'Open'}
                        </span>
                      </TD>
                      <TD><EditStatusBadge status={e.edit_status} /></TD>
                      {canEdit && (
                        <TD>
                          <button
                            onClick={() => openEdit(e)}
                            className="text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400
                                       px-3 py-1 rounded-lg transition-colors"
                          >
                            Edit
                          </button>
                        </TD>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">

            <div className="p-6 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white">Edit Time Entry</h2>
              <p className="text-slate-400 text-sm mt-0.5">
                {editing.entryUser
                  ? `${editing.entryUser.first_name} ${editing.entryUser.last_name}`
                  : `User #${editing.entry.user_id}`}
              </p>
            </div>

            <div className="p-6 space-y-4">
              {/* Show original times if already edited before */}
              {editing.entry.original_clock_in && (
                <div className="bg-slate-900/60 border border-slate-600 rounded-xl p-3 text-xs">
                  <p className="font-semibold text-slate-400 mb-1">Original times (first edit snapshot)</p>
                  <p className="text-slate-300">In:  {fmtDT(editing.entry.original_clock_in)}</p>
                  {editing.entry.original_clock_out && (
                    <p className="text-slate-300">Out: {fmtDT(editing.entry.original_clock_out)}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">Clock In</label>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={editing.form.clock_in}
                  onChange={e => setEditing(prev => ({
                    ...prev, form: { ...prev.form, clock_in: e.target.value }
                  }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">Clock Out</label>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={editing.form.clock_out}
                  disabled={!editing.entry.clock_out}
                  onChange={e => setEditing(prev => ({
                    ...prev, form: { ...prev.form, clock_out: e.target.value }
                  }))}
                />
                {!editing.entry.clock_out && (
                  <p className="text-xs text-slate-500 mt-1">Shift is still open — cannot set clock-out.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">Edit Notes</label>
                <textarea
                  rows={3}
                  className={inputCls + ' resize-none'}
                  placeholder="Reason for edit…"
                  value={editing.form.edit_notes}
                  onChange={e => setEditing(prev => ({
                    ...prev, form: { ...prev.form, edit_notes: e.target.value }
                  }))}
                />
              </div>

              {err && <p className="text-red-400 text-sm">{err}</p>}
            </div>

            <div className="p-6 pt-2 flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3
                           rounded-xl transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Edit'}
              </button>
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3
                           rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
