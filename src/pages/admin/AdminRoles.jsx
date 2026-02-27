import { useState, useEffect } from 'react'
import { db, writeAuditLog } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

// ── Permission schema ─────────────────────────────────────────────────────
const GROUPS = [
  {
    label: 'Administration',
    keys: [
      { key: 'manage_stores',   label: 'Manage Stores' },
      { key: 'manage_roles',    label: 'Manage Roles' },
      { key: 'manage_users',    label: 'Manage Users' },
      { key: 'manage_settings', label: 'Manage Settings' },
    ],
  },
  {
    label: 'Time & Attendance',
    keys: [
      { key: 'clock_in_out',         label: 'Clock In / Out' },
      { key: 'edit_own_time',         label: 'Edit Own Time Entries' },
      { key: 'edit_any_time',         label: 'Edit Any Time Entry' },
      { key: 'approve_time_entries',  label: 'Approve Time Entries' },
    ],
  },
  {
    label: 'Reports & Audit',
    keys: [
      { key: 'view_own_reports',   label: 'View Own Reports' },
      { key: 'view_store_reports', label: 'View Store Reports' },
      { key: 'view_all_reports',   label: 'View All Reports' },
      { key: 'view_audit_log',     label: 'View Audit Log' },
    ],
  },
  {
    label: 'Alerts',
    keys: [
      { key: 'manage_alerts',    label: 'Create & Manage Alerts' },
      { key: 'respond_to_alerts', label: 'Respond to Alerts' },
    ],
  },
]

const ALL_KEYS = GROUPS.flatMap(g => g.keys.map(k => k.key))

function emptyPerms() {
  return Object.fromEntries(ALL_KEYS.map(k => [k, false]))
}

// ── Main component ────────────────────────────────────────────────────────
export default function AdminRoles() {
  const { user: me } = useAuth()
  const [roles,    setRoles]    = useState([])
  const [selected, setSelected] = useState(null)   // role being edited
  const [perms,    setPerms]    = useState({})      // live permission state
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [showNew,  setShowNew]  = useState(false)
  const [newName,  setNewName]  = useState('')
  const [nameErr,  setNameErr]  = useState('')

  useEffect(() => { loadRoles() }, [])

  async function loadRoles() {
    const list = await db.roles.toArray()
    setRoles(list)
    if (list.length && !selected) selectRole(list[0])
  }

  function selectRole(role) {
    setSelected(role)
    const base  = emptyPerms()
    const saved = typeof role.permissions === 'string'
      ? JSON.parse(role.permissions)
      : role.permissions ?? {}
    setPerms({ ...base, ...saved })
    setSaved(false)
  }

  function toggle(key) {
    setPerms(p => ({ ...p, [key]: !p[key] }))
    setSaved(false)
  }

  async function saveRole() {
    if (!selected) return
    setSaving(true)
    try {
      const permStr = JSON.stringify(perms)
      await db.roles.update(selected.id, { permissions: permStr })
      await writeAuditLog({
        userId: me?.id, storeId: null,
        action: 'edit_role', entityType: 'role', entityId: selected.id,
        newValue: { permissions: perms },
      })
      setSaved(true)
      await loadRoles()
    } finally {
      setSaving(false)
    }
  }

  async function createRole() {
    const name = newName.trim()
    if (!name) { setNameErr('Name is required'); return }
    try {
      await db.roles.add({
        name,
        permissions: JSON.stringify(emptyPerms()),
        created_at:  new Date().toISOString(),
      })
      setShowNew(false)
      setNewName('')
      setNameErr('')
      await loadRoles()
    } catch (err) {
      if (err.name === 'ConstraintError') setNameErr('A role with that name already exists.')
      else setNameErr(err.message)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Roles</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage permissions for each role</p>
        </div>
        <button
          onClick={() => { setShowNew(true); setNewName(''); setNameErr('') }}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2.5
                     rounded-xl text-sm transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Role
        </button>
      </div>

      <div className="flex gap-4 h-[calc(100vh-160px)]">

        {/* ── Role list ──────────────────────────────────────────────────── */}
        <aside className="w-52 shrink-0 bg-slate-800 rounded-2xl border border-slate-700
                          overflow-y-auto p-2 space-y-0.5">
          {roles.map(r => (
            <button
              key={r.id}
              onClick={() => selectRole(r)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${
                selected?.id === r.id
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {r.name}
            </button>
          ))}
        </aside>

        {/* ── Permission editor ──────────────────────────────────────────── */}
        <div className="flex-1 bg-slate-800 rounded-2xl border border-slate-700
                        flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                <h2 className="font-bold text-white">{selected.name}</h2>
                <div className="flex items-center gap-3">
                  {saved && <span className="text-emerald-400 text-sm">Saved ✓</span>}
                  <button
                    onClick={saveRole}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold
                               px-4 py-2 rounded-xl transition-colors disabled:opacity-50
                               flex items-center gap-2"
                  >
                    {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto p-6 space-y-6">
                {GROUPS.map(group => (
                  <div key={group.label}>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {group.keys.map(({ key, label }) => (
                        <label
                          key={key}
                          className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer
                                      border transition-colors select-none ${
                            perms[key]
                              ? 'border-blue-500/50 bg-blue-500/10'
                              : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!perms[key]}
                            onChange={() => toggle(key)}
                            className="w-4 h-4 accent-blue-500 rounded shrink-0"
                          />
                          <span className="text-sm text-white">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              Select a role to edit permissions
            </div>
          )}
        </div>
      </div>

      {/* New role modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 p-6 shadow-2xl">
            <h2 className="font-bold text-white mb-4">New Role</h2>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Role Name</label>
            <input
              autoFocus
              className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2.5
                         placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm mb-1"
              placeholder="e.g. Shift Lead"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createRole()}
            />
            {nameErr && <p className="text-red-400 text-xs mb-3">{nameErr}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowNew(false)}
                className="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-xl text-sm hover:border-slate-400 transition-colors">
                Cancel
              </button>
              <button onClick={createRole}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition-colors">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
