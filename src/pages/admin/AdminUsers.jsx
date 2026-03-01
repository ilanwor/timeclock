import { useState, useEffect } from 'react'
import bcrypt from 'bcryptjs'
import { db, writeAuditLog } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

// ── Shared UI ─────────────────────────────────────────────────────────────
const inputCls = `w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2.5
  placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1
  focus:ring-blue-500 transition-colors text-sm`
const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5'

function Badge({ active }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/40 text-slate-400'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

// ── Form panel ────────────────────────────────────────────────────────────
function UserForm({ editing, roles, stores, onSave, onClose, saving }) {
  const isEdit = !!editing
  const [form, setForm] = useState({
    first_name:             editing?.first_name  ?? '',
    last_name:              editing?.last_name   ?? '',
    email:                  editing?.email       ?? '',
    password:               '',
    pin:                    '',
    pin_confirm:            '',
    role_id:                editing?.role_id     ?? '',
    store_ids:              editing?.store_ids
      ? JSON.parse(editing.store_ids)
      : editing?.store_id ? [editing.store_id] : [],
    break_reminder_enabled: editing?.break_reminder_enabled !== 0,  // default true
  })
  const [errors, setErrors] = useState({})

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function toggleStore(id) {
    setForm(f => ({
      ...f,
      store_ids: f.store_ids.includes(id)
        ? f.store_ids.filter(s => s !== id)
        : [...f.store_ids, id],
    }))
  }

  function validate() {
    const e = {}
    if (!form.first_name.trim()) e.first_name = 'Required'
    if (!form.last_name.trim())  e.last_name  = 'Required'
    if (!form.email.trim())      e.email      = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'

    if (!isEdit && !form.password)  e.password = 'Required for new users'
    if (form.password && form.password.length < 8) e.password = 'Min 8 characters'

    if (!isEdit && !form.pin)       e.pin = 'Required for new users'
    if (form.pin) {
      if (!/^\d+$/.test(form.pin))           e.pin = 'Digits only'
      else if (form.pin.length < 4)          e.pin = 'Min 4 digits'
      else if (form.pin.length > 10)         e.pin = 'Max 10 digits'
      else if (form.pin !== form.pin_confirm) e.pin_confirm = 'PINs do not match'
    }

    if (!form.role_id)               e.role_id   = 'Select a role'
    if (!form.store_ids.length)      e.store_ids = 'Select at least one store'
    return e
  }

  function handleSubmit(e) {
    e.preventDefault()
    const e2 = validate()
    if (Object.keys(e2).length) { setErrors(e2); return }
    onSave(form)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700
                      flex flex-col max-h-[90vh] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="font-bold text-white">{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4 flex-1">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>First Name <span className="text-red-400">*</span></label>
              <input className={inputCls} value={form.first_name}
                onChange={e => set('first_name', e.target.value)} placeholder="First" />
              {errors.first_name && <p className="text-red-400 text-xs mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label className={labelCls}>Last Name <span className="text-red-400">*</span></label>
              <input className={inputCls} value={form.last_name}
                onChange={e => set('last_name', e.target.value)} placeholder="Last" />
              {errors.last_name && <p className="text-red-400 text-xs mt-1">{errors.last_name}</p>}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className={labelCls}>Email <span className="text-red-400">*</span></label>
            <input type="email" className={inputCls} value={form.email}
              onChange={e => set('email', e.target.value)} placeholder="user@example.com" />
            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
          </div>

          {/* Password */}
          <div>
            <label className={labelCls}>
              Password {isEdit && <span className="text-slate-500 font-normal">(leave blank to keep current)</span>}
              {!isEdit && <span className="text-red-400"> *</span>}
            </label>
            <input type="password" className={inputCls} value={form.password}
              onChange={e => set('password', e.target.value)} placeholder={isEdit ? '••••••••' : 'Min 8 characters'} />
            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
          </div>

          {/* PIN row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                PIN (4–10 digits) {!isEdit && <span className="text-red-400">*</span>}
                {isEdit && <span className="text-slate-500 font-normal text-xs"> (blank = keep)</span>}
              </label>
              <input type="password" inputMode="numeric" maxLength={10}
                className={inputCls} value={form.pin}
                onChange={e => set('pin', e.target.value.replace(/\D/g, ''))}
                placeholder="4–10 digits" />
              {errors.pin && <p className="text-red-400 text-xs mt-1">{errors.pin}</p>}
            </div>
            <div>
              <label className={labelCls}>Confirm PIN</label>
              <input type="password" inputMode="numeric" maxLength={10}
                className={inputCls} value={form.pin_confirm}
                onChange={e => set('pin_confirm', e.target.value.replace(/\D/g, ''))}
                placeholder="Re-enter PIN" />
              {errors.pin_confirm && <p className="text-red-400 text-xs mt-1">{errors.pin_confirm}</p>}
            </div>
          </div>

          {/* Role */}
          <div>
            <label className={labelCls}>Role <span className="text-red-400">*</span></label>
            <select className={inputCls} value={form.role_id}
              onChange={e => set('role_id', parseInt(e.target.value, 10) || '')}>
              <option value="">— Select role —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {errors.role_id && <p className="text-red-400 text-xs mt-1">{errors.role_id}</p>}
          </div>

          {/* Stores multi-select */}
          <div>
            <label className={labelCls}>Stores <span className="text-red-400">*</span></label>
            <div className="space-y-2 bg-slate-900 rounded-lg p-3 border border-slate-600">
              {stores.map(s => (
                <label key={s.id} className="flex items-center gap-3 cursor-pointer select-none">
                  <input type="checkbox" checked={form.store_ids.includes(s.id)}
                    onChange={() => toggleStore(s.id)}
                    className="w-4 h-4 accent-blue-500 rounded" />
                  <span className="text-sm text-white">{s.name}</span>
                  {!s.is_active && <span className="text-xs text-slate-500">(inactive)</span>}
                </label>
              ))}
            </div>
            {errors.store_ids && <p className="text-red-400 text-xs mt-1">{errors.store_ids}</p>}
          </div>

          {/* Break reminder toggle */}
          <div className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-3
                          border border-slate-600">
            <div>
              <p className="text-sm font-medium text-slate-300">Break Reminder</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Show a pop-up when this employee's shift exceeds the reminder threshold
              </p>
            </div>
            <button
              type="button"
              onClick={() => set('break_reminder_enabled', !form.break_reminder_enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
                          border-2 border-transparent transition-colors duration-200
                          focus:outline-none ${form.break_reminder_enabled ? 'bg-blue-600' : 'bg-slate-600'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow
                                transition-transform duration-200
                                ${form.break_reminder_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="p-5 border-t border-slate-700 flex gap-3">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 border border-slate-600 hover:border-slate-400 text-slate-300
                       hover:text-white rounded-xl text-sm transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold
                       rounded-xl text-sm transition-colors disabled:opacity-50
                       flex items-center justify-center gap-2">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function AdminUsers() {
  const { user: me } = useAuth()
  const [users,   setUsers]   = useState([])
  const [roles,   setRoles]   = useState([])
  const [stores,  setStores]  = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen,   setFormOpen]   = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState('')
  const [search,     setSearch]     = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [rawUsers, rawRoles, rawStores] = await Promise.all([
      db.users.toArray(),
      db.roles.toArray(),
      db.stores.toArray(),
    ])
    const roleMap  = Object.fromEntries(rawRoles.map(r => [r.id, r]))
    const storeMap = Object.fromEntries(rawStores.map(s => [s.id, s]))
    setUsers(rawUsers.map(u => ({
      ...u,
      roleName:  roleMap[u.role_id]?.name ?? '—',
      storeName: storeMap[u.store_id]?.name ?? '—',
    })))
    setRoles(rawRoles)
    setStores(rawStores)
    setLoading(false)
  }

  async function handleSave(form) {
    setSaving(true)
    setSaveError('')
    try {
      const now      = new Date().toISOString()
      const storeId  = form.store_ids[0]
      const storeIds = JSON.stringify(form.store_ids)

      // Build updates (only hash if provided)
      const updates = {
        first_name:             form.first_name.trim(),
        last_name:              form.last_name.trim(),
        email:                  form.email.trim().toLowerCase(),
        role_id:                form.role_id,
        store_id:               storeId,
        store_ids:              storeIds,
        break_reminder_enabled: form.break_reminder_enabled ? 1 : 0,
        updated_at:             now,
      }
      if (form.password) updates.password_hash = await bcrypt.hash(form.password, 10)
      if (form.pin)      updates.pin_hash       = await bcrypt.hash(form.pin, 10)

      if (editing) {
        await db.users.update(editing.id, updates)
        await writeAuditLog({ userId: me?.id, storeId, action: 'edit_user',
          entityType: 'user', entityId: editing.id, newValue: { email: updates.email } })
      } else {
        const id = await db.users.add({ ...updates, is_active: 1, created_at: now })
        await writeAuditLog({ userId: me?.id, storeId, action: 'create_user',
          entityType: 'user', entityId: id, newValue: { email: updates.email } })
      }
      setFormOpen(false)
      setEditing(null)
      await loadData()
    } catch (err) {
      if (err.name === 'ConstraintError') setSaveError('That email is already in use.')
      else setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user) {
    const next = user.is_active ? 0 : 1
    await db.users.update(user.id, { is_active: next, updated_at: new Date().toISOString() })
    await writeAuditLog({ userId: me?.id, storeId: user.store_id,
      action: next ? 'activate_user' : 'deactivate_user',
      entityType: 'user', entityId: user.id })
    await loadData()
  }

  const filtered = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-slate-400 text-sm mt-0.5">{users.length} total employees</p>
        </div>
        <button
          onClick={() => { setEditing(null); setSaveError(''); setFormOpen(true) }}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2.5
                     rounded-xl text-sm transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          className={`${inputCls} max-w-sm`}
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No users found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Store</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id}
                  className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors
                              ${i === filtered.length - 1 ? 'border-b-0' : ''}`}>
                  <td className="px-4 py-3 font-medium text-white">
                    {u.first_name} {u.last_name}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{u.email}</td>
                  <td className="px-4 py-3 text-slate-300">{u.roleName}</td>
                  <td className="px-4 py-3 text-slate-300">{u.storeName}</td>
                  <td className="px-4 py-3"><Badge active={u.is_active} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setEditing(u); setSaveError(''); setFormOpen(true) }}
                        className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white
                                   rounded-lg transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(u)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          u.is_active
                            ? 'bg-red-900/40 hover:bg-red-900/60 text-red-400'
                            : 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-400'
                        }`}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Form modal */}
      {formOpen && (
        <>
          {saveError && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-red-600 text-white
                            px-5 py-3 rounded-xl text-sm shadow-xl">
              {saveError}
            </div>
          )}
          <UserForm
            editing={editing}
            roles={roles}
            stores={stores}
            saving={saving}
            onSave={handleSave}
            onClose={() => { setFormOpen(false); setEditing(null); setSaveError('') }}
          />
        </>
      )}
    </div>
  )
}
