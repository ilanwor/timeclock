import { useState, useEffect } from 'react'
import { formatDistanceToNow, parseISO, format } from 'date-fns'
import { db } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

// ── Type display config ────────────────────────────────────────────────────
const TYPE_CFG = {
  info:    { label: 'Info',    badge: 'bg-blue-500/20 text-blue-400',   accent: 'bg-blue-500' },
  warning: { label: 'Warning', badge: 'bg-amber-500/20 text-amber-400', accent: 'bg-amber-500' },
  urgent:  { label: 'Urgent',  badge: 'bg-red-500/20 text-red-400',     accent: 'bg-red-500' },
}

function relTime(iso) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }) }
  catch { return iso }
}

function absTime(iso) {
  try { return format(parseISO(iso), 'MMM d, yyyy h:mm a') }
  catch { return iso }
}

// ── Alert card ─────────────────────────────────────────────────────────────
function AlertCard({ alert, storeName, onMarkRead, onDismiss, isBusy }) {
  const cfg    = TYPE_CFG[alert.type] || TYPE_CFG.info
  const isRead = !!alert.is_read

  return (
    <div className={`relative rounded-xl border overflow-hidden transition-all duration-200
      ${isRead ? 'bg-slate-800/40 border-slate-700/50' : 'bg-slate-800 border-slate-700'}`}
    >
      {/* Colored left accent strip — visible on unread only */}
      {!isRead && (
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.accent}`} />
      )}

      <div className={`flex gap-3 p-4 ${!isRead ? 'pl-5' : ''}`}>

        {/* Body */}
        <div className="flex-1 min-w-0">

          {/* Top row: type badge + title */}
          <div className="flex items-start gap-2 flex-wrap mb-1.5">
            <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
              {cfg.label}
            </span>
            <p className={`text-sm font-semibold leading-snug ${isRead ? 'text-slate-400' : 'text-white'}`}>
              {alert.title}
            </p>
          </div>

          {/* Message */}
          <p className={`text-sm leading-relaxed mb-2 ${isRead ? 'text-slate-500' : 'text-slate-300'}`}>
            {alert.message}
          </p>

          {/* Metadata */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span title={absTime(alert.created_at)} className="cursor-default">
              {relTime(alert.created_at)}
            </span>
            {storeName && <span>· {storeName}</span>}
            {alert.triggering_entry_id && (
              <span>· Entry #{alert.triggering_entry_id}</span>
            )}
            {alert._dismissed && <span className="text-slate-600">· Dismissed</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex gap-2 items-start pt-0.5">
          {isBusy ? (
            <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin mt-1" />
          ) : (
            <>
              {!isRead && (
                <button
                  onClick={() => onMarkRead(alert)}
                  title="Mark as read"
                  className="text-xs px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600
                             text-slate-300 hover:text-white rounded-lg transition-colors"
                >
                  ✓ Read
                </button>
              )}
              {!alert._dismissed && (
                <button
                  onClick={() => onDismiss(alert)}
                  title="Dismiss"
                  className="text-xs px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600
                             text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                >
                  × Dismiss
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Tab button ─────────────────────────────────────────────────────────────
function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function AdminInbox() {
  const { user: me } = useAuth()

  const [alerts,  setAlerts]  = useState([])
  const [stores,  setStores]  = useState({})    // id → name
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('unread')
  const [busy,    setBusy]    = useState(new Set())  // alert IDs being actioned

  useEffect(() => { if (me) load() }, [me?.id])

  async function load() {
    setLoading(true)
    const now = new Date().toISOString()

    const [rawAlerts, rawStores] = await Promise.all([
      db.alerts
        .filter(a => {
          if (a.expires_at && a.expires_at < now) return false
          // Match alerts addressed directly to this user or to their role
          return a.target_user_id === me.id || a.target_role_id === me.role_id
        })
        .toArray(),
      db.stores.toArray(),
    ])

    // Newest first
    rawAlerts.sort((a, b) => b.created_at.localeCompare(a.created_at))

    setAlerts(rawAlerts)
    setStores(Object.fromEntries(rawStores.map(s => [s.id, s.name])))
    setLoading(false)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function toggleBusy(id, on) {
    setBusy(prev => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  async function markRead(alert) {
    toggleBusy(alert.id, true)
    await db.alerts.update(alert.id, { is_read: 1 })
    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, is_read: 1 } : a))
    toggleBusy(alert.id, false)
  }

  async function dismiss(alert) {
    toggleBusy(alert.id, true)
    await Promise.all([
      db.notification_responses.add({
        alert_id:        alert.id,
        notification_id: null,
        user_id:         me.id,
        response:        'dismissed',
        responded_at:    new Date().toISOString(),
      }),
      db.alerts.update(alert.id, { is_read: 1 }),
    ])
    // Keep in list so user can see it was dismissed; mark both read + _dismissed flag
    setAlerts(prev => prev.map(a =>
      a.id === alert.id ? { ...a, is_read: 1, _dismissed: true } : a
    ))
    toggleBusy(alert.id, false)
  }

  async function markAllRead() {
    const unread = alerts.filter(a => !a.is_read)
    await Promise.all(unread.map(a => db.alerts.update(a.id, { is_read: 1 })))
    setAlerts(prev => prev.map(a => ({ ...a, is_read: 1 })))
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const unreadCount = alerts.filter(a => !a.is_read).length
  const displayed   = tab === 'unread' ? alerts.filter(a => !a.is_read) : alerts

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Inbox</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {loading
              ? 'Loading…'
              : unreadCount > 0
                ? `${unreadCount} unread alert${unreadCount !== 1 ? 's' : ''}`
                : 'All caught up'}
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'unread' && unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-sm text-slate-400 hover:text-white border border-slate-700
                         hover:border-slate-500 px-4 py-2 rounded-lg transition-colors"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="text-sm text-slate-400 hover:text-white border border-slate-700
                       hover:border-slate-500 px-4 py-2 rounded-lg transition-colors
                       disabled:opacity-40"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-900 rounded-xl p-1 w-fit border border-slate-800">
        <Tab active={tab === 'unread'} onClick={() => setTab('unread')}>
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Tab>
        <Tab active={tab === 'all'} onClick={() => setTab('all')}>
          All ({alerts.length})
        </Tab>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-slate-500 text-center py-16">Loading inbox…</div>

      ) : displayed.length === 0 ? (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 py-20 text-center">
          <p className="text-3xl mb-3">{tab === 'unread' ? '✓' : '📭'}</p>
          <p className="text-slate-300 font-medium">
            {tab === 'unread' ? 'No unread alerts' : 'No alerts yet'}
          </p>
          <p className="text-slate-600 text-sm mt-1">
            {tab === 'unread'
              ? 'Switch to All to see past alerts.'
              : 'Compliance and system alerts will appear here.'}
          </p>
        </div>

      ) : (
        <div className="space-y-3">
          {displayed.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              storeName={stores[alert.store_id]}
              onMarkRead={markRead}
              onDismiss={dismiss}
              isBusy={busy.has(alert.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
