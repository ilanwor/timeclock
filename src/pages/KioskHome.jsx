import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import bcrypt from 'bcryptjs'
import { db } from '../db/db'
import PinPad from '../components/PinPad'
import ClockFlow from '../components/ClockFlow'

// ── Default status colors (overridden by settings table) ──────────────────
const DEFAULT_COLORS = {
  clocked_in:  '#059669',
  on_break:    '#d97706',
  clocked_out: '#334155',
}

const STATUS_LABELS = {
  clocked_in:  'Clocked In',
  on_break:    'On Break',
  clocked_out: 'Clocked Out',
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatElapsed(since) {
  if (!since) return null
  const ms  = Date.now() - new Date(since).getTime()
  const s   = Math.floor(ms / 1000)
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

// loadStatuses fetches employee status AND break compliance indicators.
async function loadStatuses(storeId) {
  // Load users, open entries, and break-reminder settings in parallel
  const [users, openEntries, settingsRows] = await Promise.all([
    db.users.where('store_id').equals(storeId).and(u => u.is_active === 1).toArray(),
    db.time_entries.where('store_id').equals(storeId).and(e => e.clock_out === null).toArray(),
    db.settings.where('store_id').equals(0)
      .filter(r => r.key === 'break_reminder_enabled' || r.key === 'break_reminder_after_minutes')
      .toArray(),
  ])

  const settingsMap      = Object.fromEntries(settingsRows.map(r => [r.key, r.value]))
  const globalReminderOn = settingsMap['break_reminder_enabled'] !== 'false'
  const reminderAfterMin = parseFloat(settingsMap['break_reminder_after_minutes'] || '300')

  const openEntryIds = openEntries.map(e => e.id)

  // Fetch open breaks + completed breaks for open entries together
  const [openBreaks, doneBreaks] = openEntryIds.length
    ? await Promise.all([
        db.breaks.where('time_entry_id').anyOf(openEntryIds).and(b => b.break_end === null).toArray(),
        db.breaks.where('time_entry_id').anyOf(openEntryIds).and(b => b.break_end != null).toArray(),
      ])
    : [[], []]

  const nowMs = Date.now()

  return users
    .sort((a, b) => a.first_name.localeCompare(b.first_name))
    .map(user => {
      const openEntry = openEntries.find(e => e.user_id === user.id) ?? null
      const openBreak = openEntry
        ? (openBreaks.find(b => b.time_entry_id === openEntry.id) ?? null)
        : null

      let status = 'clocked_out', since = null
      if (openEntry) {
        status = openBreak ? 'on_break' : 'clocked_in'
        since  = openBreak ? openBreak.break_start : openEntry.clock_in
      }

      // Break reminder indicator
      const hasCompletedBreak = openEntry
        ? doneBreaks.some(b => b.time_entry_id === openEntry.id)
        : false
      const shiftMins = openEntry
        ? (nowMs - new Date(openEntry.clock_in).getTime()) / 60_000
        : 0
      const needsBreakReminder = globalReminderOn
        && status === 'clocked_in'
        && user.break_reminder_enabled !== 0   // undefined → true (default on)
        && shiftMins >= reminderAfterMin
        && !hasCompletedBreak

      return { user, status, since, openEntry, openBreak, needsBreakReminder }
    })
}

async function findUserByPin(pin, employees) {
  const results = await Promise.all(
    employees.map(async emp => ({
      emp,
      match: await bcrypt.compare(pin, emp.user.pin_hash),
    }))
  )
  return results.find(r => r.match)?.emp ?? null
}

// ── Component ─────────────────────────────────────────────────────────────
export default function KioskHome() {
  const storeId = parseInt(localStorage.getItem('kiosk_store_id') || '1', 10)

  const [store,      setStore]      = useState(null)
  const [employees,  setEmployees]  = useState([])
  const [colors,     setColors]     = useState(DEFAULT_COLORS)
  const [now,        setNow]        = useState(new Date())
  const [selected,   setSelected]   = useState(null)
  const [pin,        setPin]        = useState('')
  const [pinState,   setPinState]   = useState('idle')
  const [pinError,   setPinError]   = useState('')
  const [clockFlow,  setClockFlow]  = useState(null)
  const [toast,      setToast]      = useState(null)
  const refreshRef = useRef(null)

  useEffect(() => { db.stores.get(storeId).then(setStore) }, [storeId])

  useEffect(() => {
    async function loadColors() {
      const keys = ['kiosk_color_clocked_in', 'kiosk_color_on_break', 'kiosk_color_clocked_out']
      const rows = await db.settings
        .where('[store_id+key]').anyOf(keys.map(k => [storeId, k]))
        .toArray()
      const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
      setColors({
        clocked_in:  map['kiosk_color_clocked_in']  || DEFAULT_COLORS.clocked_in,
        on_break:    map['kiosk_color_on_break']     || DEFAULT_COLORS.on_break,
        clocked_out: map['kiosk_color_clocked_out']  || DEFAULT_COLORS.clocked_out,
      })
    }
    loadColors()
  }, [storeId])

  const refresh = useCallback(() => {
    loadStatuses(storeId).then(setEmployees)
  }, [storeId])

  useEffect(() => {
    refresh()
    refreshRef.current = setInterval(refresh, 30_000)
    return () => clearInterval(refreshRef.current)
  }, [refresh])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  async function handlePinComplete(enteredPin) {
    setPinState('checking')
    setPinError('')
    try {
      const pool  = selected ? [selected] : employees
      const match = await findUserByPin(enteredPin, pool)
      if (!match) {
        setPinState('error')
        setPinError('PIN not recognized. Try again.')
        setTimeout(() => { setPin(''); setPinState('idle'); setPinError('') }, 1800)
        return
      }
      setPinState('idle')
      setPin('')
      setSelected(null)
      setClockFlow(match)
    } catch {
      setPinState('error')
      setPinError('Something went wrong.')
      setTimeout(() => { setPin(''); setPinState('idle'); setPinError('') }, 1800)
    }
  }

  function handleFlowDone(message) {
    setClockFlow(null)
    showToast(message, 'success')
    refresh()
  }

  function handleFlowCancel() { setClockFlow(null) }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  function tileColor(status) { return colors[status] || DEFAULT_COLORS[status] }

  // ── Legend break-reminder count ────────────────────────────────────────
  const reminderCount = employees.filter(e => e.needsBreakReminder).length

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="font-bold leading-tight">{store?.name ?? '—'}</p>
            <p className="text-xs text-slate-400">{store?.address}</p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-2xl font-mono font-semibold tabular-nums">
            {format(now, 'h:mm:ss aa')}
          </p>
          <p className="text-xs text-slate-400">{format(now, 'EEEE, MMMM d, yyyy')}</p>
        </div>

        <Link
          to="/login"
          className="text-sm text-slate-400 hover:text-white border border-slate-700
                     hover:border-slate-500 px-4 py-2 rounded-lg transition-colors"
        >
          Admin Login
        </Link>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: PIN pad panel ──────────────────────────────────────── */}
        <aside className="w-80 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col items-center justify-center p-6 gap-6">
          <div className="text-center min-h-[3rem]">
            {selected ? (
              <>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">Clocking</p>
                <p className="text-lg font-bold text-blue-400">
                  {selected.user.first_name} {selected.user.last_name}
                </p>
                <button
                  onClick={() => { setSelected(null); setPin('') }}
                  className="text-xs text-slate-500 hover:text-slate-300 mt-1"
                >
                  Clear selection
                </button>
              </>
            ) : (
              <p className="text-slate-400 text-sm">Enter your PIN<br />or tap your name</p>
            )}
          </div>

          <PinPad
            value={pin}
            onChange={setPin}
            onComplete={handlePinComplete}
            disabled={pinState === 'checking'}
            minLength={4}
            maxLength={10}
          />

          <div className="min-h-[2rem] text-center">
            {pinState === 'checking' && (
              <div className="flex items-center gap-2 text-blue-400 text-sm">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Checking PIN…
              </div>
            )}
            {pinState === 'error' && (
              <p className="text-red-400 text-sm font-medium">{pinError}</p>
            )}
          </div>
        </aside>

        {/* ── RIGHT: Employee tiles ─────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-6">
          {employees.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-600">
              <p>No employees found for this store.</p>
            </div>
          ) : (
            <>
              {/* Legend */}
              <div className="flex gap-4 mb-4 flex-wrap items-center">
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2 text-sm text-slate-400">
                    <div className="w-3 h-3 rounded-full" style={{ background: tileColor(key) }} />
                    {label}
                  </div>
                ))}
                {reminderCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400 ml-2">
                    {/* coffee cup icon */}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                    </svg>
                    Break overdue ({reminderCount})
                  </div>
                )}
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {employees.map(emp => {
                  const isSelected = selected?.user.id === emp.user.id
                  return (
                    <button
                      key={emp.user.id}
                      onClick={() => {
                        setSelected(isSelected ? null : emp)
                        setPin('')
                        setPinState('idle')
                        setPinError('')
                      }}
                      style={{ background: tileColor(emp.status) }}
                      className={`
                        relative rounded-2xl p-4 text-left transition-all duration-150
                        hover:brightness-110 active:scale-95 focus:outline-none
                        ${isSelected ? 'ring-4 ring-white ring-offset-2 ring-offset-slate-950' : ''}
                      `}
                    >
                      {/* Status dot — top right */}
                      <div className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full
                        ${emp.status === 'clocked_in'  ? 'bg-white animate-pulse' :
                          emp.status === 'on_break'    ? 'bg-yellow-200 animate-pulse' :
                                                         'bg-white/30'}`}
                      />

                      {/* Break reminder badge — bottom right */}
                      {emp.needsBreakReminder && (
                        <div className="absolute bottom-2.5 right-2.5 w-5 h-5 bg-amber-500
                                        rounded-full flex items-center justify-center shadow-lg"
                          title="Break overdue">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                          </svg>
                        </div>
                      )}

                      {/* Name */}
                      <p className="font-bold text-white leading-tight truncate pr-5">
                        {emp.user.first_name}
                      </p>
                      <p className="text-white/70 text-sm truncate">
                        {emp.user.last_name}
                      </p>

                      {/* Status */}
                      <p className="text-white/60 text-xs mt-2 uppercase tracking-widest">
                        {STATUS_LABELS[emp.status]}
                      </p>

                      {/* Elapsed */}
                      {emp.since && (
                        <p className="text-white font-mono text-sm mt-0.5 tabular-nums">
                          {formatElapsed(emp.since)}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </main>
      </div>

      {/* ── Clock Flow Wizard ───────────────────────────────────────────── */}
      {clockFlow && (
        <ClockFlow
          employee={clockFlow}
          storeId={storeId}
          onDone={handleFlowDone}
          onCancel={handleFlowCancel}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl
          text-sm font-medium shadow-2xl transition-all ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' :
            toast.type === 'error'   ? 'bg-red-600 text-white'    :
                                       'bg-blue-600 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
