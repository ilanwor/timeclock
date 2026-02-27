import { useState, useEffect } from 'react'
import { db, writeAuditLog } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

// ── Settings schema ───────────────────────────────────────────────────────
// type: 'text' | 'number' | 'action' | 'color'
// scope: 'global' (store_id=0) | 'store' (per-store)
const SCHEMA = [
  {
    group: 'General',
    scope: 'global',
    keys: [
      { key: 'app_name',            label: 'App Name',                     type: 'text',   default: 'TimeClock Pro' },
      { key: 'session_timeout_mins',label: 'Session Timeout (minutes)',     type: 'number', default: '30' },
    ],
  },
  {
    group: 'Shift Rules',
    scope: 'global',
    keys: [
      { key: 'max_shift_hours',          label: 'Maximum Shift Length (hours)',    type: 'number', default: '12' },
      { key: 'rule_min_shift_minutes',   label: 'Minimum Shift Duration (min)',    type: 'number', default: '0' },
      { key: 'rule_min_rest_hours',      label: 'Min Rest Between Shifts (hrs)',   type: 'number', default: '8' },
      { key: 'rule_min_rest_action',     label: 'Min Rest Violation Action',       type: 'action', default: 'warn' },
      { key: 'rule_time_rounding_minutes',label:'Time Rounding Interval (min)',    type: 'select_rounding', default: '0' },
    ],
  },
  {
    group: 'Daily & Weekly Limits',
    scope: 'global',
    keys: [
      { key: 'rule_daily_hours_limit',       label: 'Daily Hours Limit',              type: 'number', default: '12' },
      { key: 'rule_daily_hours_action',      label: 'Daily Limit Action',             type: 'action', default: 'warn' },
      { key: 'rule_daily_ot_threshold',      label: 'Daily OT Threshold (hrs)',       type: 'number', default: '8' },
      { key: 'overtime_threshold',           label: 'Weekly OT Threshold (hrs)',      type: 'number', default: '40' },
      { key: 'rule_weekly_hours_action',     label: 'Weekly Overtime Action',         type: 'action', default: 'warn' },
      { key: 'rule_max_consecutive_days',    label: 'Max Consecutive Work Days',      type: 'number', default: '7' },
      { key: 'rule_consecutive_days_action', label: 'Consecutive Days Action',        type: 'action', default: 'warn' },
    ],
  },
  {
    group: 'Break Policy',
    scope: 'global',
    keys: [
      { key: 'break_required_after',   label: 'Break Required After (hrs)',       type: 'number',  default: '6' },
      { key: 'paid_break_minutes',     label: 'Paid Break Duration (min)',         type: 'number',  default: '15' },
      { key: 'unpaid_break_minutes',   label: 'Unpaid Break Duration (min)',       type: 'number',  default: '30' },
      { key: 'rule_auto_deduct_break', label: 'Auto-Deduct Break if None Taken',  type: 'boolean', default: 'false' },
    ],
  },
  {
    group: 'Break Compliance',
    scope: 'global',
    keys: [
      { key: 'break_reminder_enabled',       label: 'Enable Break Reminders',               type: 'boolean', default: 'true' },
      { key: 'break_reminder_after_minutes', label: 'Remind After (minutes on shift)',       type: 'number',  default: '300' },
      { key: 'break_penalty_enabled',        label: 'Apply Penalty for Missed Meal Break',   type: 'boolean', default: 'false' },
      { key: 'break_penalty_minutes',        label: 'Penalty Duration (minutes added)',       type: 'number',  default: '60' },
    ],
  },
  {
    group: 'Auto Sign-Out',
    scope: 'global',
    keys: [
      { key: 'rule_auto_signout_enabled', label: 'Enable Auto Sign-Out',          type: 'boolean', default: 'true' },
      { key: 'rule_auto_signout_hours',   label: 'Auto Sign-Out After (hrs)',      type: 'number',  default: '14' },
    ],
  },
  {
    group: 'PIN Policy',
    scope: 'global',
    keys: [
      { key: 'pin_length', label: 'Minimum PIN Length (digits)', type: 'number', default: '7' },
    ],
  },
  {
    group: 'Alert Channels',
    scope: 'global',
    keys: [
      {
        key: 'alert_channel_email',
        label: 'Email Alerts (Phase 2 — requires backend proxy + SendGrid key)',
        type: 'boolean',
        default: 'false',
      },
      {
        key: 'alert_channel_sms',
        label: 'SMS Alerts (Phase 2 — requires backend proxy + Twilio key + user phone field)',
        type: 'boolean',
        default: 'false',
      },
    ],
  },
  {
    group: 'Kiosk Colors',
    scope: 'store',
    keys: [
      { key: 'kiosk_color_clocked_in',  label: 'Clocked In Color',  type: 'color', default: '#059669' },
      { key: 'kiosk_color_on_break',    label: 'On Break Color',    type: 'color', default: '#d97706' },
      { key: 'kiosk_color_clocked_out', label: 'Clocked Out Color', type: 'color', default: '#334155' },
    ],
  },
]

const ALL_KEYS = SCHEMA.flatMap(g => g.keys)

// ── Upsert helper ─────────────────────────────────────────────────────────
async function upsertSetting(storeId, key, value) {
  const existing = await db.settings.where('[store_id+key]').equals([storeId, key]).first()
  const now      = new Date().toISOString()
  if (existing) {
    await db.settings.update(existing.id, { value, updated_at: now })
  } else {
    await db.settings.add({ store_id: storeId, key, value, updated_at: now })
  }
}

// ── Input components ──────────────────────────────────────────────────────
const baseCls = `w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2
  focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition-colors`

function SettingInput({ def, value, onChange }) {
  if (def.type === 'action') {
    return (
      <select className={baseCls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="warn">Warn — employee may proceed after acknowledging</option>
        <option value="block">Block — manager override required</option>
      </select>
    )
  }
  if (def.type === 'boolean') {
    return (
      <select className={baseCls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
    )
  }
  if (def.type === 'select_rounding') {
    return (
      <select className={baseCls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="0">No rounding</option>
        <option value="5">5 minutes</option>
        <option value="10">10 minutes</option>
        <option value="15">15 minutes (quarter-hour)</option>
        <option value="30">30 minutes (half-hour)</option>
      </select>
    )
  }
  if (def.type === 'color') {
    return (
      <div className="flex items-center gap-3">
        <input type="color" value={value || def.default}
          onChange={e => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0.5" />
        <input
          className={`${baseCls} flex-1`}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={def.default}
        />
        <div className="w-8 h-8 rounded-lg shrink-0 border border-slate-600"
          style={{ background: value || def.default }} />
      </div>
    )
  }
  return (
    <input
      type={def.type === 'number' ? 'number' : 'text'}
      className={baseCls}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={def.default}
      min={def.type === 'number' ? '0' : undefined}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function AdminSettings() {
  const { user: me } = useAuth()
  const [stores,   setStores]   = useState([])
  const [storeId,  setStoreId]  = useState(0)     // 0 = global
  const [values,   setValues]   = useState({})    // key → value string
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  useEffect(() => { db.stores.toArray().then(s => { setStores(s) }) }, [])
  useEffect(() => { loadSettings() }, [storeId])

  async function loadSettings() {
    setLoading(true)
    setSaved(false)
    // Load global + store-specific (store-specific wins)
    const rows = await db.settings.where('store_id').anyOf([0, storeId]).toArray()
    const map  = {}
    rows.filter(r => r.store_id === 0).forEach(r => (map[r.key] = r.value))
    rows.filter(r => r.store_id === storeId).forEach(r => (map[r.key] = r.value))
    // Fill defaults for any missing key
    ALL_KEYS.forEach(def => { if (!(def.key in map)) map[def.key] = def.default })
    setValues(map)
    setLoading(false)
  }

  function set(key, value) {
    setValues(v => ({ ...v, [key]: value }))
    setSaved(false)
  }

  async function saveAll() {
    setSaving(true)
    try {
      for (const group of SCHEMA) {
        const sid = group.scope === 'store' ? storeId : 0
        for (const def of group.keys) {
          if (values[def.key] !== undefined) {
            await upsertSetting(sid, def.key, values[def.key])
          }
        }
      }
      await writeAuditLog({ userId: me?.id, storeId,
        action: 'update_settings', entityType: 'settings', entityId: null,
        newValue: values })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-0.5">Configure rules and behaviour</p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving || loading}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5
                     rounded-xl text-sm transition-colors disabled:opacity-50
                     flex items-center gap-2"
        >
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save All'}
        </button>
      </div>

      {/* Store picker (for per-store sections) */}
      <div className="flex items-center gap-3 mb-6 bg-slate-800 rounded-xl px-4 py-3 border border-slate-700">
        <span className="text-sm text-slate-400 shrink-0">Kiosk color scope:</span>
        <select
          className="flex-1 bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:border-blue-500"
          value={storeId}
          onChange={e => setStoreId(parseInt(e.target.value, 10))}
        >
          <option value={0}>Global defaults</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="text-xs text-slate-500 shrink-0">
          Global rules apply to all stores unless overridden.
        </p>
      </div>

      {loading ? (
        <div className="text-slate-500 text-center py-12">Loading settings…</div>
      ) : (
        <div className="space-y-6">
          {SCHEMA.map(group => (
            <div key={group.group}
              className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-700 flex items-center gap-2">
                <h2 className="font-semibold text-white text-sm">{group.group}</h2>
                {group.scope === 'store' && (
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                    per-store
                  </span>
                )}
              </div>
              <div className="p-5 space-y-4">
                {group.keys.map(def => (
                  <div key={def.key}>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      {def.label}
                    </label>
                    <SettingInput
                      def={def}
                      value={values[def.key] ?? def.default}
                      onChange={v => set(def.key, v)}
                    />
                    <p className="text-xs text-slate-600 mt-1">key: {def.key}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
