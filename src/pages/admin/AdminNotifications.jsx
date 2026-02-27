import { useState, useEffect } from 'react'
import { db, writeAuditLog } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

const TRIGGER_LABELS = {
  clock_in:    'Clock In',
  clock_out:   'Clock Out',
  start_break: 'Start Break',
  end_break:   'End Break',
}

function genId() {
  return String(Date.now() + Math.random())
}

function defaultForm() {
  return {
    title:               '',
    trigger_event:       'clock_in',
    scope_type:          'all',
    scope_id:            null,
    is_active:           true,
    is_required:         false,
    repeat_type:         'always',
    expires_at:          '',
    questions:           [],
    conditional_actions: [],
  }
}

// ── Main component ─────────────────────────────────────────────────────────
export default function AdminNotifications() {
  const { user: me }        = useAuth()
  const [notifs,   setNotifs]   = useState([])
  const [stores,   setStores]   = useState([])
  const [roles,    setRoles]    = useState([])
  const [users,    setUsers]    = useState([])
  const [modalOpen,setModalOpen]= useState(false)
  const [editing,  setEditing]  = useState(null)
  const [form,     setForm]     = useState(defaultForm)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    loadNotifs()
    db.stores.toArray().then(setStores)
    db.roles.toArray().then(setRoles)
    db.users.where('is_active').equals(1).toArray().then(setUsers)
  }, [])

  async function loadNotifs() {
    const rows = await db.notifications.orderBy('created_at').reverse().toArray()
    setNotifs(rows)
  }

  function openCreate() {
    setEditing(null)
    setForm(defaultForm())
    setModalOpen(true)
  }

  function openEdit(n) {
    setEditing(n)
    setForm({
      title:               n.title || '',
      trigger_event:       n.trigger_event || 'clock_in',
      scope_type:          n.scope_type || 'all',
      scope_id:            n.scope_id ?? null,
      is_active:           !!n.is_active,
      is_required:         !!n.is_required,
      repeat_type:         n.repeat_type || 'always',
      expires_at:          n.expires_at ? n.expires_at.slice(0, 10) : '',
      questions:           JSON.parse(n.questions || '[]'),
      conditional_actions: JSON.parse(n.conditional_actions || '[]').map(a => ({ ...a, _id: genId() })),
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const now    = new Date().toISOString()
      const record = {
        title:               form.title.trim(),
        trigger_event:       form.trigger_event,
        scope_type:          form.scope_type,
        scope_id:            form.scope_type === 'all' ? null : (form.scope_id != null ? Number(form.scope_id) : null),
        is_active:           form.is_active  ? 1 : 0,
        is_required:         form.is_required ? 1 : 0,
        repeat_type:         form.repeat_type,
        expires_at:          form.expires_at ? new Date(form.expires_at).toISOString() : null,
        questions:           JSON.stringify(form.questions),
        // Strip local _id field from actions before saving
        conditional_actions: JSON.stringify(form.conditional_actions.map(({ _id, ...rest }) => rest)),
        updated_at:          now,
      }
      if (editing) {
        await db.notifications.update(editing.id, record)
        await writeAuditLog({ userId: me?.id, storeId: null, action: 'update_notification',
          entityType: 'notification', entityId: editing.id, newValue: record })
      } else {
        const id = await db.notifications.add({ ...record, created_at: now })
        await writeAuditLog({ userId: me?.id, storeId: null, action: 'create_notification',
          entityType: 'notification', entityId: id, newValue: record })
      }
      setModalOpen(false)
      loadNotifs()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(n) {
    await db.notifications.update(n.id, { is_active: n.is_active ? 0 : 1 })
    loadNotifs()
  }

  async function handleDelete(n) {
    if (!window.confirm(`Delete "${n.title}"?`)) return
    await db.notifications.delete(n.id)
    loadNotifs()
  }

  // ── Question helpers ──
  const addQuestion = () =>
    setForm(f => ({ ...f, questions: [...f.questions, { id: genId(), label: '', type: 'yes_no', required: false }] }))
  const updateQuestion = (i, field, val) =>
    setForm(f => ({ ...f, questions: f.questions.map((q, j) => j === i ? { ...q, [field]: val } : q) }))
  const removeQuestion = i =>
    setForm(f => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))

  // ── Action helpers ──
  const addAction = () =>
    setForm(f => ({ ...f, conditional_actions: [...f.conditional_actions, {
      _id: genId(), condition: null, action_type: 'block', action_data: { message: '' },
    }]}))
  const updateAction = (i, updater) =>
    setForm(f => ({ ...f, conditional_actions: f.conditional_actions.map((a, j) => j === i ? updater(a) : a) }))
  const removeAction = i =>
    setForm(f => ({ ...f, conditional_actions: f.conditional_actions.filter((_, j) => j !== i) }))

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Event-triggered prompts with questions and conditional actions
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2.5
                     rounded-xl text-sm transition-colors"
        >
          + New Notification
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {notifs.length === 0 ? (
          <p className="text-slate-500 text-center py-12 text-sm">
            No notifications configured yet. Create one to prompt employees at clock events.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Title</th>
                <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Trigger</th>
                <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Scope</th>
                <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Repeat</th>
                <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Status</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {notifs.map(n => {
                const qCount = JSON.parse(n.questions || '[]').length
                const aCount = JSON.parse(n.conditional_actions || '[]').length
                return (
                  <tr key={n.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="px-5 py-3">
                      <p className="font-medium text-white">{n.title}</p>
                      <p className="text-slate-500 text-xs mt-0.5">
                        {qCount} question{qCount !== 1 ? 's' : ''} · {aCount} action{aCount !== 1 ? 's' : ''}
                        {n.is_required ? ' · required' : ''}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-slate-300">
                      {TRIGGER_LABELS[n.trigger_event] || n.trigger_event}
                    </td>
                    <td className="px-5 py-3 text-slate-300 capitalize">{n.scope_type}</td>
                    <td className="px-5 py-3 text-slate-300 capitalize">{n.repeat_type}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleActive(n)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                          n.is_active
                            ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                            : 'bg-slate-600/50 text-slate-400 hover:bg-slate-600/70'
                        }`}
                      >
                        {n.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => openEdit(n)}
                        className="text-slate-400 hover:text-white text-xs transition-colors">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(n)}
                        className="text-red-400 hover:text-red-300 text-xs transition-colors">
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <NotifModal
          form={form}
          setForm={setForm}
          stores={stores}
          roles={roles}
          users={users}
          addQuestion={addQuestion}
          updateQuestion={updateQuestion}
          removeQuestion={removeQuestion}
          addAction={addAction}
          updateAction={updateAction}
          removeAction={removeAction}
          editing={editing}
          saving={saving}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────
function NotifModal({
  form, setForm, stores, roles, users,
  addQuestion, updateQuestion, removeQuestion,
  addAction, updateAction, removeAction,
  editing, saving, onSave, onClose,
}) {
  const F = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const inputCls = `w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2
    focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm`

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-slate-700
                      flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <h2 className="font-bold text-white">
            {editing ? 'Edit Notification' : 'New Notification'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-6 space-y-5 flex-1">

          {/* Basic info */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Title *</label>
            <input
              className={inputCls}
              value={form.title}
              onChange={e => F('title', e.target.value)}
              placeholder="e.g. Daily Safety Check"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Trigger Event</label>
              <select className={inputCls} value={form.trigger_event}
                onChange={e => F('trigger_event', e.target.value)}>
                <option value="clock_in">Clock In</option>
                <option value="clock_out">Clock Out</option>
                <option value="start_break">Start Break</option>
                <option value="end_break">End Break</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Repeat Policy</label>
              <select className={inputCls} value={form.repeat_type}
                onChange={e => F('repeat_type', e.target.value)}>
                <option value="always">Every time</option>
                <option value="daily">Once per day</option>
                <option value="once">Once ever</option>
              </select>
            </div>
          </div>

          {/* Scope */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Scope</label>
              <select className={inputCls} value={form.scope_type}
                onChange={e => { F('scope_type', e.target.value); F('scope_id', null) }}>
                <option value="all">All employees</option>
                <option value="store">Specific store</option>
                <option value="role">Specific role</option>
                <option value="user">Specific user</option>
              </select>
            </div>
            {form.scope_type !== 'all' && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {form.scope_type === 'store' ? 'Store' : form.scope_type === 'role' ? 'Role' : 'User'}
                </label>
                <select className={inputCls} value={form.scope_id ?? ''}
                  onChange={e => F('scope_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Select —</option>
                  {form.scope_type === 'store' && stores.map(s =>
                    <option key={s.id} value={s.id}>{s.name}</option>)}
                  {form.scope_type === 'role' && roles.map(r =>
                    <option key={r.id} value={r.id}>{r.name}</option>)}
                  {form.scope_type === 'user' && users.map(u =>
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Flags row */}
          <div className="grid grid-cols-3 gap-4">
            <ToggleField label="Active" value={form.is_active} onChange={v => F('is_active', v)} />
            <ToggleField label="Required (can't dismiss)" value={form.is_required}
              onChange={v => F('is_required', v)} />
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Expires (optional)</label>
              <input type="date" className={inputCls} value={form.expires_at}
                onChange={e => F('expires_at', e.target.value)} />
            </div>
          </div>

          {/* Questions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Questions</h3>
              <button onClick={addQuestion}
                className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors">
                + Add Question
              </button>
            </div>
            {form.questions.length === 0 && (
              <p className="text-slate-600 text-xs italic">
                No questions — the notification shows as an info message with an Acknowledge button.
              </p>
            )}
            <div className="space-y-3">
              {form.questions.map((q, i) => (
                <div key={q.id} className="bg-slate-700/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs font-mono shrink-0">Q{i + 1}</span>
                    <input
                      className={`${inputCls} flex-1`}
                      value={q.label}
                      onChange={e => updateQuestion(i, 'label', e.target.value)}
                      placeholder="Question text…"
                    />
                    <button onClick={() => removeQuestion(i)}
                      className="text-red-400 hover:text-red-300 text-lg shrink-0 leading-none">×</button>
                  </div>
                  <div className="flex items-center gap-3 pl-6">
                    <select className={`${inputCls} flex-1`} value={q.type}
                      onChange={e => updateQuestion(i, 'type', e.target.value)}>
                      <option value="yes_no">Yes / No</option>
                      <option value="text">Free text response</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm text-slate-400 whitespace-nowrap cursor-pointer">
                      <input type="checkbox" checked={q.required}
                        onChange={e => updateQuestion(i, 'required', e.target.checked)}
                        className="accent-blue-500 cursor-pointer" />
                      Required
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Conditional Actions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Conditional Actions</h3>
              <button onClick={addAction}
                className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors">
                + Add Action
              </button>
            </div>
            {form.conditional_actions.length === 0 && (
              <p className="text-slate-600 text-xs italic">
                No actions — responses will be recorded without triggering any automatic behaviour.
              </p>
            )}
            <div className="space-y-4">
              {form.conditional_actions.map((a, i) => (
                <ActionEditor
                  key={a._id}
                  action={a}
                  questions={form.questions}
                  onChange={updater => updateAction(i, updater)}
                  onRemove={() => removeAction(i)}
                  inputCls={inputCls}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-700 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.title.trim()}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold
                       rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toggle helper ──────────────────────────────────────────────────────────
function ToggleField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <select
        className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2
                   text-sm focus:outline-none focus:border-blue-500"
        value={value ? 'true' : 'false'}
        onChange={e => onChange(e.target.value === 'true')}
      >
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
    </div>
  )
}

// ── Action editor ──────────────────────────────────────────────────────────
function ActionEditor({ action, questions, onChange, onRemove, inputCls }) {
  const hasCondition = action.condition !== null

  function setCondition(field, val) {
    onChange(a => ({
      ...a,
      condition: {
        ...(a.condition || { question_id: '', operator: 'equals', value: '' }),
        [field]: val,
      },
    }))
  }

  function setActionType(val) {
    const defaults = {
      block:            { message: '' },
      create_alert:     { alert_type: 'info', title: '', message: '' },
      add_note:         {},
      flag_entry:       {},
      require_approval: {},
    }
    onChange(a => ({ ...a, action_type: val, action_data: defaults[val] || {} }))
  }

  function setActionData(field, val) {
    onChange(a => ({ ...a, action_data: { ...a.action_data, [field]: val } }))
  }

  const condQ  = action.condition?.question_id || ''
  const condOp = action.condition?.operator    || 'equals'

  return (
    <div className="bg-slate-700/50 rounded-xl p-4 space-y-3 border border-slate-600/50">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Action</span>
        <button onClick={onRemove} className="text-red-400 hover:text-red-300 text-lg leading-none">×</button>
      </div>

      {/* Condition toggle */}
      <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={hasCondition}
          onChange={e => onChange(a => ({
            ...a,
            condition: e.target.checked
              ? { question_id: questions[0]?.id || '', operator: 'equals', value: '' }
              : null,
          }))}
          className="accent-blue-500 cursor-pointer"
        />
        Only fire if a condition is met
      </label>

      {/* Condition fields */}
      {hasCondition && (
        <div className="grid grid-cols-3 gap-2 pl-5">
          <select className={`${inputCls} text-xs`} value={condQ}
            onChange={e => setCondition('question_id', e.target.value)}>
            <option value="">— Question —</option>
            {questions.map((q, i) => (
              <option key={q.id} value={q.id}>
                Q{i + 1}: {q.label.slice(0, 28) || '(untitled)'}
              </option>
            ))}
          </select>
          <select className={`${inputCls} text-xs`} value={condOp}
            onChange={e => setCondition('operator', e.target.value)}>
            <option value="answered">is answered</option>
            <option value="equals">equals</option>
            <option value="not_equals">≠ not equals</option>
            <option value="contains">contains</option>
          </select>
          {condOp !== 'answered' ? (
            <input
              className={`${inputCls} text-xs`}
              value={action.condition?.value || ''}
              onChange={e => setCondition('value', e.target.value)}
              placeholder="e.g. yes / no / text"
            />
          ) : <div />}
        </div>
      )}

      {/* Action type */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Then…</label>
        <select className={inputCls} value={action.action_type}
          onChange={e => setActionType(e.target.value)}>
          <option value="block">Block — prevent the clock action</option>
          <option value="create_alert">Create an alert for managers</option>
          <option value="add_note">Add note to time entry</option>
          <option value="flag_entry">Flag time entry for review</option>
          <option value="require_approval">Require manager approval</option>
        </select>
      </div>

      {/* Action-type-specific fields */}
      {action.action_type === 'block' && (
        <input
          className={inputCls}
          value={action.action_data?.message || ''}
          onChange={e => setActionData('message', e.target.value)}
          placeholder="Message shown to employee…"
        />
      )}

      {action.action_type === 'create_alert' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={action.action_data?.alert_type || 'info'}
              onChange={e => setActionData('alert_type', e.target.value)}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="urgent">Urgent</option>
            </select>
            <input className={inputCls} value={action.action_data?.title || ''}
              onChange={e => setActionData('title', e.target.value)}
              placeholder="Alert title…" />
          </div>
          <input className={inputCls} value={action.action_data?.message || ''}
            onChange={e => setActionData('message', e.target.value)}
            placeholder="Alert message…" />
        </div>
      )}

      {(action.action_type === 'add_note' ||
        action.action_type === 'flag_entry' ||
        action.action_type === 'require_approval') && (
        <p className="text-slate-500 text-xs italic">No additional configuration required.</p>
      )}
    </div>
  )
}
