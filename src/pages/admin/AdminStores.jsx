import { useState, useEffect } from 'react'
import { db, writeAuditLog } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

const inputCls = `w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2.5
  placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1
  focus:ring-blue-500 transition-colors text-sm`
const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5'

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
  'Pacific/Honolulu', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo',
]

// ── Store form modal ──────────────────────────────────────────────────────
function StoreForm({ editing, onSave, onClose, saving }) {
  const isEdit = !!editing
  const [form, setForm] = useState({
    name:          editing?.name          ?? '',
    store_number:  editing?.store_number  ?? '',
    address:       editing?.address       ?? '',
    phone:         editing?.phone         ?? '',
    timezone:      editing?.timezone      ?? 'America/Chicago',
  })
  const [errors, setErrors] = useState({})

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function validate() {
    const e = {}
    if (!form.name.trim())         e.name         = 'Store name is required'
    if (!form.store_number.trim()) e.store_number = 'Store number is required'
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
      <div className="bg-slate-800 rounded-2xl w-full max-w-md border border-slate-700
                      flex flex-col max-h-[90vh] shadow-2xl">

        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="font-bold text-white">{isEdit ? 'Edit Store' : 'Add Store'}</h2>
          <button onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4 flex-1">
          {/* Name + Number row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Store Name <span className="text-red-400">*</span></label>
              <input className={inputCls} value={form.name}
                onChange={e => set('name', e.target.value)} placeholder="Main Street Store" />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className={labelCls}>Store # <span className="text-red-400">*</span></label>
              <input className={inputCls} value={form.store_number}
                onChange={e => set('store_number', e.target.value)} placeholder="001" />
              {errors.store_number && <p className="text-red-400 text-xs mt-1">{errors.store_number}</p>}
            </div>
          </div>

          <div>
            <label className={labelCls}>Address</label>
            <input className={inputCls} value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="123 Main St, Springfield, IL 62701" />
          </div>

          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} type="tel" value={form.phone}
              onChange={e => set('phone', e.target.value)} placeholder="(217) 555-0101" />
          </div>

          <div>
            <label className={labelCls}>Timezone</label>
            <select className={inputCls} value={form.timezone}
              onChange={e => set('timezone', e.target.value)}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </form>

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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Store'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function AdminStores() {
  const { user: me } = useAuth()
  const [stores,   setStores]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => { loadStores() }, [])

  async function loadStores() {
    setLoading(true)
    setStores(await db.stores.toArray())
    setLoading(false)
  }

  async function handleSave(form) {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (editing) {
        await db.stores.update(editing.id, form)
        await writeAuditLog({ userId: me?.id, storeId: editing.id,
          action: 'edit_store', entityType: 'store', entityId: editing.id, newValue: form })
      } else {
        const id = await db.stores.add({ ...form, is_active: 1, created_at: now })
        await writeAuditLog({ userId: me?.id, storeId: id,
          action: 'create_store', entityType: 'store', entityId: id, newValue: form })
      }
      setFormOpen(false)
      setEditing(null)
      await loadStores()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(store) {
    const next = store.is_active ? 0 : 1
    await db.stores.update(store.id, { is_active: next })
    await writeAuditLog({ userId: me?.id, storeId: store.id,
      action: next ? 'activate_store' : 'deactivate_store',
      entityType: 'store', entityId: store.id })
    await loadStores()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Stores</h1>
          <p className="text-slate-400 text-sm mt-0.5">{stores.length} location{stores.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setFormOpen(true) }}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2.5
                     rounded-xl text-sm transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Store
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-slate-500 col-span-full text-center py-12">Loading…</p>
        ) : stores.length === 0 ? (
          <p className="text-slate-500 col-span-full text-center py-12">No stores yet.</p>
        ) : stores.map(s => (
          <div key={s.id}
            className={`bg-slate-800 rounded-2xl border p-5 transition-colors ${
              s.is_active ? 'border-slate-700' : 'border-slate-700/50 opacity-60'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-bold text-white">{s.name}</p>
                {s.store_number && (
                  <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full mt-1 inline-block">
                    #{s.store_number}
                  </span>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                s.is_active
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-slate-600/40 text-slate-400'
              }`}>
                {s.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            {s.address && <p className="text-xs text-slate-400 mb-1">{s.address}</p>}
            {s.phone   && <p className="text-xs text-slate-400 mb-1">{s.phone}</p>}
            {s.timezone && <p className="text-xs text-slate-500">{s.timezone}</p>}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setEditing(s); setFormOpen(true) }}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm
                           rounded-lg transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => toggleActive(s)}
                className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
                  s.is_active
                    ? 'bg-red-900/40 hover:bg-red-900/60 text-red-400'
                    : 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-400'
                }`}
              >
                {s.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {formOpen && (
        <StoreForm
          editing={editing}
          saving={saving}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
