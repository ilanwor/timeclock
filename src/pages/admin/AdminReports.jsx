import { useState, useMemo } from 'react'
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, subMonths, format, parseISO, isWithinInterval,
  differenceInMinutes,
} from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { db } from '../../db/db'
import { useAuth } from '../../context/AuthContext'

// ── Period presets ─────────────────────────────────────────────────────────
function getPresetRange(preset) {
  const now = new Date()
  switch (preset) {
    case 'this_week':  return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'last_week': { const w = subWeeks(now, 1); return { from: startOfWeek(w, { weekStartsOn: 1 }), to: endOfWeek(w, { weekStartsOn: 1 }) } }
    case 'this_month': return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'last_month': { const m = subMonths(now, 1); return { from: startOfMonth(m), to: endOfMonth(m) } }
    default:           return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
  }
}

// ── Minute helpers ─────────────────────────────────────────────────────────
function fmtMins(mins) {
  if (mins == null || isNaN(mins)) return '—'
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.round(Math.abs(mins) % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}
function fmtHrs(mins) {
  if (mins == null || isNaN(mins)) return '—'
  return (mins / 60).toFixed(2)
}

// ── CSV download ───────────────────────────────────────────────────────────
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))]
  const blob  = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url   = URL.createObjectURL(blob)
  const a     = document.createElement('a')
  a.href      = url
  a.download  = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── PDF (print) ────────────────────────────────────────────────────────────
function printTable(title, subtitle, headers, rows) {
  const th = headers.map(h => `<th>${h}</th>`).join('')
  const tbody = rows.map(r =>
    `<tr>${r.map(c => `<td>${c == null ? '' : c}</td>`).join('')}</tr>`
  ).join('')
  const win = window.open('', '_blank')
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 24px; font-size: 13px; color: #111; }
        h1 { margin: 0; font-size: 20px; }
        p  { margin: 4px 0 16px; color: #666; font-size: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
        th { background: #f0f0f0; font-weight: 600; }
        tr:nth-child(even) { background: #fafafa; }
        @media print { @page { margin: 1cm; } }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <p>${subtitle}</p>
      <table><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table>
    </body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}

// ── Data loader ────────────────────────────────────────────────────────────
async function fetchAll(fromDate, toDate) {
  const [users, allEntries, allBreaks, settings] = await Promise.all([
    db.users.toArray(),
    db.time_entries.toArray(),
    db.breaks.toArray(),
    db.settings.where('store_id').equals(0)
      .filter(r =>
        r.key === 'rule_daily_ot_threshold' ||
        r.key === 'overtime_threshold'      ||
        r.key === 'break_required_after'
      )
      .toArray(),
  ])

  const settingsMap      = Object.fromEntries(settings.map(r => [r.key, r.value]))
  const dailyOtHrs       = parseFloat(settingsMap['rule_daily_ot_threshold'] || '8')
  const weeklyOtHrs      = parseFloat(settingsMap['overtime_threshold']      || '40')
  const breakRequiredHrs = parseFloat(settingsMap['break_required_after']    || '6')

  const interval = { start: fromDate, end: toDate }

  // Filter entries that overlap the date range (clock_in within range)
  const entries = allEntries.filter(e => {
    try { return isWithinInterval(parseISO(e.clock_in), interval) }
    catch { return false }
  })

  // Index breaks by time_entry_id
  const breaksByEntry = {}
  allBreaks.forEach(b => {
    if (!breaksByEntry[b.time_entry_id]) breaksByEntry[b.time_entry_id] = []
    breaksByEntry[b.time_entry_id].push(b)
  })

  // Index users by id
  const usersById = Object.fromEntries(users.map(u => [u.id, u]))

  return { entries, breaksByEntry, usersById, dailyOtHrs, weeklyOtHrs, breakRequiredHrs }
}

// ── Timesheet rows ─────────────────────────────────────────────────────────
function buildTimesheetRows(entries, breaksByEntry, usersById) {
  return entries
    .map(e => {
      const user      = usersById[e.user_id]
      if (!user) return null
      const breaks    = breaksByEntry[e.id] || []
      const breakMins = breaks
        .filter(b => b.break_end)
        .reduce((sum, b) => sum + differenceInMinutes(parseISO(b.break_end), parseISO(b.break_start)), 0)
      const clockOut  = e.clock_out ? parseISO(e.clock_out) : null
      const grossMins = clockOut ? differenceInMinutes(clockOut, parseISO(e.clock_in)) : null
      const penalty   = e.penalty_minutes || 0
      const netMins   = grossMins != null ? grossMins - breakMins + penalty : null
      return {
        userId: user.id,
        name:   `${user.first_name} ${user.last_name}`,
        date:   format(parseISO(e.clock_in), 'yyyy-MM-dd'),
        clockIn:  format(parseISO(e.clock_in), 'h:mm a'),
        clockOut: clockOut ? format(clockOut, 'h:mm a') : 'Open',
        status:   e.clock_out ? 'Completed' : 'Open',
        grossMins, breakMins, netMins, penalty,
        editStatus: e.edit_status ?? null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))
}

// ── Overtime summary ───────────────────────────────────────────────────────
function buildOvertimeSummary(entries, breaksByEntry, usersById, dailyOtHrs, weeklyOtHrs) {
  const byUser = {}

  entries.forEach(e => {
    const user = usersById[e.user_id]
    if (!user || !e.clock_out) return
    const breaks    = breaksByEntry[e.id] || []
    const breakMins = breaks
      .filter(b => b.break_end)
      .reduce((sum, b) => sum + differenceInMinutes(parseISO(b.break_end), parseISO(b.break_start)), 0)
    const grossMins = differenceInMinutes(parseISO(e.clock_out), parseISO(e.clock_in))
    const penalty   = e.penalty_minutes || 0
    const netMins   = grossMins - breakMins + penalty
    const dailyOtMins = Math.max(0, netMins - dailyOtHrs * 60)
    const regularDayMins = netMins - dailyOtMins

    if (!byUser[user.id]) {
      byUser[user.id] = { name: `${user.first_name} ${user.last_name}`, totalMins: 0, regularMins: 0, dailyOtMins: 0, weeklyOtMins: 0, shiftCount: 0 }
    }
    byUser[user.id].totalMins   += netMins
    byUser[user.id].regularMins += regularDayMins
    byUser[user.id].dailyOtMins += dailyOtMins
    byUser[user.id].shiftCount  += 1
  })

  // Apply weekly OT threshold on top of daily OT
  return Object.values(byUser).map(row => {
    const weeklyOtMins = Math.max(0, row.totalMins - weeklyOtHrs * 60)
    return { ...row, weeklyOtMins }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

// ── Break compliance rows ──────────────────────────────────────────────────
function buildBreakComplianceRows(entries, breaksByEntry, usersById, breakRequiredHrs) {
  const requiredAfterMins = breakRequiredHrs * 60

  return entries
    .filter(e => {
      if (!e.clock_out) return false
      const grossMins = differenceInMinutes(parseISO(e.clock_out), parseISO(e.clock_in))
      return grossMins >= requiredAfterMins
    })
    .map(e => {
      const user   = usersById[e.user_id]
      if (!user) return null
      const breaks = breaksByEntry[e.id] || []
      const hadBreak   = breaks.some(b => b.break_end != null)
      const penalty    = e.penalty_minutes || 0
      const grossMins  = differenceInMinutes(parseISO(e.clock_out), parseISO(e.clock_in))
      return {
        name:      `${user.first_name} ${user.last_name}`,
        date:      format(parseISO(e.clock_in), 'yyyy-MM-dd'),
        grossMins,
        hadBreak,
        penaltyMins: penalty,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))
}

// ── Tab Button ─────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  )
}

// ── Th / Td helpers ────────────────────────────────────────────────────────
const TH = ({ children, right }) => (
  <th className={`px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
)
const TD = ({ children, right, mono, accent }) => (
  <td className={`px-4 py-3 text-sm border-t border-slate-800 ${right ? 'text-right' : ''} ${mono ? 'font-mono tabular-nums' : ''} ${accent || 'text-slate-300'}`}>
    {children}
  </td>
)

// ── Main component ─────────────────────────────────────────────────────────
export default function AdminReports() {
  const { user: me } = useAuth()

  const [tab,          setTab]          = useState('timesheet')
  const [preset,       setPreset]       = useState('this_week')
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')
  const [filterUserId, setFilterUserId] = useState('all')

  const [loading,      setLoading]      = useState(false)
  const [ran,          setRan]          = useState(false)
  const [data,         setData]         = useState(null)   // { entries, breaksByEntry, usersById, dailyOtHrs, weeklyOtHrs }
  const [userList,     setUserList]     = useState([])     // for dropdown — populated once

  // Populate the employee dropdown on first render
  useState(() => {
    db.users.orderBy('first_name').toArray().then(setUserList)
  })

  // Resolve date range
  function resolvedRange() {
    if (preset === 'custom') {
      const from = customFrom ? new Date(customFrom + 'T00:00:00') : new Date()
      const to   = customTo   ? new Date(customTo   + 'T23:59:59') : new Date()
      return { from, to }
    }
    return getPresetRange(preset)
  }

  async function runReport() {
    setLoading(true)
    setRan(false)
    try {
      const { from, to } = resolvedRange()
      const result = await fetchAll(from, to)
      setData(result)
      setRan(true)
    } finally {
      setLoading(false)
    }
  }

  // Compute derived tables from fetched data + current filter
  const timesheetRows = useMemo(() => {
    if (!data) return []
    const rows = buildTimesheetRows(data.entries, data.breaksByEntry, data.usersById)
    return filterUserId === 'all' ? rows : rows.filter(r => r.userId === parseInt(filterUserId, 10))
  }, [data, filterUserId])

  const overtimeRows = useMemo(() => {
    if (!data) return []
    const rows = buildOvertimeSummary(data.entries, data.breaksByEntry, data.usersById, data.dailyOtHrs, data.weeklyOtHrs)
    return filterUserId === 'all' ? rows : rows.filter(r => {
      const uid = parseInt(filterUserId, 10)
      return Object.values(data.usersById).find(u => u.id === uid && `${u.first_name} ${u.last_name}` === r.name)
    })
  }, [data, filterUserId])

  const breakRows = useMemo(() => {
    if (!data) return []
    const rows = buildBreakComplianceRows(data.entries, data.breaksByEntry, data.usersById, data.breakRequiredHrs)
    return filterUserId === 'all' ? rows : rows.filter(r => {
      const uid = parseInt(filterUserId, 10)
      const u   = data.usersById[uid]
      return u && `${u.first_name} ${u.last_name}` === r.name
    })
  }, [data, filterUserId])

  // Chart data for overtime tab
  const chartData = useMemo(() =>
    overtimeRows.map(r => ({
      name:     r.name.split(' ')[0],  // first name only for brevity
      Regular:  parseFloat((r.regularMins / 60).toFixed(2)),
      'Daily OT': parseFloat((r.dailyOtMins / 60).toFixed(2)),
    })),
    [overtimeRows]
  )

  const { from: rangeFrom, to: rangeTo } = resolvedRange()
  const rangeLabel = `${format(rangeFrom, 'MMM d, yyyy')} – ${format(rangeTo, 'MMM d, yyyy')}`

  // ── Export handlers ──────────────────────────────────────────────────────
  function exportTimesheetCSV() {
    downloadCSV(
      `timesheet_${format(rangeFrom, 'yyyy-MM-dd')}.csv`,
      ['Employee', 'Date', 'Clock In', 'Clock Out', 'Status', 'Edit Status', 'Gross', 'Break', 'Net', 'Penalty'],
      timesheetRows.map(r => [
        r.name, r.date, r.clockIn, r.clockOut, r.status, r.editStatus || '',
        fmtMins(r.grossMins), fmtMins(r.breakMins), fmtMins(r.netMins), r.penalty ? fmtMins(r.penalty) : '',
      ])
    )
  }

  function exportTimesheetPDF() {
    printTable(
      'Timesheet Report', rangeLabel,
      ['Employee', 'Date', 'Clock In', 'Clock Out', 'Status', 'Edit Status', 'Gross', 'Break', 'Net', 'Penalty'],
      timesheetRows.map(r => [
        r.name, r.date, r.clockIn, r.clockOut, r.status, r.editStatus || '',
        fmtMins(r.grossMins), fmtMins(r.breakMins), fmtMins(r.netMins), r.penalty ? fmtMins(r.penalty) : '',
      ])
    )
  }

  function exportOvertimeCSV() {
    downloadCSV(
      `overtime_${format(rangeFrom, 'yyyy-MM-dd')}.csv`,
      ['Employee', 'Shifts', 'Total Hours', 'Regular Hours', 'Daily OT Hours', 'Weekly OT Hours'],
      overtimeRows.map(r => [
        r.name, r.shiftCount,
        fmtHrs(r.totalMins), fmtHrs(r.regularMins), fmtHrs(r.dailyOtMins), fmtHrs(r.weeklyOtMins),
      ])
    )
  }

  function exportOvertimePDF() {
    printTable(
      'Overtime Summary', rangeLabel,
      ['Employee', 'Shifts', 'Total Hours', 'Regular Hours', 'Daily OT Hours', 'Weekly OT Hours'],
      overtimeRows.map(r => [
        r.name, r.shiftCount,
        fmtHrs(r.totalMins), fmtHrs(r.regularMins), fmtHrs(r.dailyOtMins), fmtHrs(r.weeklyOtMins),
      ])
    )
  }

  function exportBreakCSV() {
    downloadCSV(
      `break_compliance_${format(rangeFrom, 'yyyy-MM-dd')}.csv`,
      ['Employee', 'Date', 'Shift Duration', 'Break Taken', 'Penalty Minutes'],
      breakRows.map(r => [
        r.name, r.date, fmtMins(r.grossMins), r.hadBreak ? 'Yes' : 'No', r.penaltyMins || '',
      ])
    )
  }

  function exportBreakPDF() {
    printTable(
      'Break Compliance Report', rangeLabel,
      ['Employee', 'Date', 'Shift Duration', 'Break Taken', 'Penalty Minutes'],
      breakRows.map(r => [
        r.name, r.date, fmtMins(r.grossMins), r.hadBreak ? 'Yes' : 'No', r.penaltyMins || '',
      ])
    )
  }

  // ── Shared controls bar ──────────────────────────────────────────────────
  const selectCls = `bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm
    focus:outline-none focus:border-blue-500 transition-colors`

  return (
    <div className="p-6 max-w-6xl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="text-slate-400 text-sm mt-0.5">Timesheet, overtime, and break compliance</p>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-end">

          {/* Period preset */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Period</label>
            <select className={selectCls} value={preset} onChange={e => { setPreset(e.target.value); setRan(false) }}>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Custom dates */}
          {preset === 'custom' && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">From</label>
                <input type="date" className={selectCls} value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setRan(false) }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">To</label>
                <input type="date" className={selectCls} value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setRan(false) }} />
              </div>
            </>
          )}

          {/* Employee filter */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Employee</label>
            <select className={selectCls} value={filterUserId} onChange={e => setFilterUserId(e.target.value)}>
              <option value="all">All Employees</option>
              {userList.map(u => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
              ))}
            </select>
          </div>

          {/* Run */}
          <button
            onClick={runReport}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2 rounded-lg
                       text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Running…' : 'Run Report'}
          </button>

          {ran && (
            <p className="text-xs text-slate-500 self-end pb-2">{rangeLabel}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-900 rounded-xl p-1 w-fit border border-slate-800">
        <TabBtn active={tab === 'timesheet'}  onClick={() => setTab('timesheet')}>Timesheet</TabBtn>
        <TabBtn active={tab === 'overtime'}   onClick={() => setTab('overtime')}>Overtime Summary</TabBtn>
        <TabBtn active={tab === 'breaks'}     onClick={() => setTab('breaks')}>Break Compliance</TabBtn>
      </div>

      {/* Content */}
      {!ran ? (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 py-20 text-center text-slate-500">
          Select a period and click <span className="text-slate-300 font-medium">Run Report</span> to load data.
        </div>
      ) : (
        <>
          {/* ── TIMESHEET TAB ─────────────────────────────────────────────── */}
          {tab === 'timesheet' && (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700">
                <h2 className="font-semibold text-white text-sm">
                  Timesheet — {timesheetRows.length} {timesheetRows.length === 1 ? 'entry' : 'entries'}
                </h2>
                <div className="flex gap-2">
                  <button onClick={exportTimesheetCSV}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5">
                    ↓ CSV
                  </button>
                  <button onClick={exportTimesheetPDF}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5">
                    ⎙ Print / PDF
                  </button>
                </div>
              </div>

              {timesheetRows.length === 0 ? (
                <p className="text-slate-500 text-center py-12">No entries in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-900/50">
                      <tr>
                        <TH>Employee</TH>
                        <TH>Date</TH>
                        <TH>Clock In</TH>
                        <TH>Clock Out</TH>
                        <TH>Status</TH>
                        <TH>Edit</TH>
                        <TH right>Gross</TH>
                        <TH right>Break</TH>
                        <TH right>Net</TH>
                        <TH right>Penalty</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {timesheetRows.map((r, i) => (
                        <tr key={i} className={`transition-colors ${r.editStatus ? 'bg-blue-900/20 hover:bg-blue-900/30' : 'hover:bg-slate-700/30'}`}>
                          <TD>{r.name}</TD>
                          <TD mono>{r.date}</TD>
                          <TD mono>{r.clockIn}</TD>
                          <TD mono accent={r.status === 'Open' ? 'text-amber-400' : 'text-slate-300'}>{r.clockOut}</TD>
                          <TD>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              r.status === 'Open' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                            }`}>{r.status}</span>
                          </TD>
                          <TD>
                            {r.editStatus && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                r.editStatus === 'pending_review' ? 'bg-blue-500/20 text-blue-400' :
                                r.editStatus === 'approved'       ? 'bg-emerald-500/20 text-emerald-400' :
                                r.editStatus === 'disputed'       ? 'bg-red-500/20 text-red-400' :
                                'bg-slate-700 text-slate-400'
                              }`}>
                                {r.editStatus === 'pending_review' ? 'Pending' :
                                 r.editStatus === 'approved'       ? 'Approved' :
                                 r.editStatus === 'disputed'       ? 'Disputed' : r.editStatus}
                              </span>
                            )}
                          </TD>
                          <TD right mono>{r.grossMins != null ? fmtMins(r.grossMins) : '—'}</TD>
                          <TD right mono>{fmtMins(r.breakMins)}</TD>
                          <TD right mono accent={r.netMins != null ? 'text-white' : 'text-slate-500'}>{r.netMins != null ? fmtMins(r.netMins) : '—'}</TD>
                          <TD right mono accent={r.penalty ? 'text-red-400' : 'text-slate-600'}>{r.penalty ? `+${fmtMins(r.penalty)}` : '—'}</TD>
                        </tr>
                      ))}
                    </tbody>
                    {/* Totals row */}
                    {(() => {
                      const completed = timesheetRows.filter(r => r.grossMins != null)
                      const totalGross = completed.reduce((s, r) => s + r.grossMins, 0)
                      const totalBreak = completed.reduce((s, r) => s + r.breakMins, 0)
                      const totalNet   = completed.reduce((s, r) => s + r.netMins,   0)
                      const totalPen   = completed.reduce((s, r) => s + r.penalty,   0)
                      return (
                        <tfoot>
                          <tr className="bg-slate-900/60 font-semibold text-white">
                            <td className="px-4 py-3 text-xs text-slate-400 border-t-2 border-slate-600" colSpan={6}>
                              Totals ({completed.length} completed shifts)
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-mono border-t-2 border-slate-600">{fmtMins(totalGross)}</td>
                            <td className="px-4 py-3 text-sm text-right font-mono border-t-2 border-slate-600">{fmtMins(totalBreak)}</td>
                            <td className="px-4 py-3 text-sm text-right font-mono border-t-2 border-slate-600">{fmtMins(totalNet)}</td>
                            <td className={`px-4 py-3 text-sm text-right font-mono border-t-2 border-slate-600 ${totalPen ? 'text-red-400' : 'text-slate-600'}`}>
                              {totalPen ? `+${fmtMins(totalPen)}` : '—'}
                            </td>
                          </tr>
                        </tfoot>
                      )
                    })()}
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── OVERTIME TAB ──────────────────────────────────────────────── */}
          {tab === 'overtime' && (
            <div className="space-y-4">
              {/* Bar chart */}
              {chartData.length > 0 && (
                <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                  <h2 className="font-semibold text-white text-sm mb-4">Hours by Employee</h2>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} unit="h" />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                        labelStyle={{ color: '#f8fafc' }}
                        itemStyle={{ color: '#94a3b8' }}
                        formatter={(v, name) => [`${v}h`, name]}
                      />
                      <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
                      <Bar dataKey="Regular"   fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Daily OT"  fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Table */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700">
                  <h2 className="font-semibold text-white text-sm">
                    Overtime Summary — {overtimeRows.length} {overtimeRows.length === 1 ? 'employee' : 'employees'}
                  </h2>
                  <div className="flex gap-2">
                    <button onClick={exportOvertimeCSV}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                      ↓ CSV
                    </button>
                    <button onClick={exportOvertimePDF}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                      ⎙ Print / PDF
                    </button>
                  </div>
                </div>

                {overtimeRows.length === 0 ? (
                  <p className="text-slate-500 text-center py-12">No completed shifts in this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-900/50">
                        <tr>
                          <TH>Employee</TH>
                          <TH right>Shifts</TH>
                          <TH right>Total Hours</TH>
                          <TH right>Regular Hours</TH>
                          <TH right>Daily OT</TH>
                          <TH right>Weekly OT</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {overtimeRows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                            <TD>{r.name}</TD>
                            <TD right mono>{r.shiftCount}</TD>
                            <TD right mono accent="text-white">{fmtHrs(r.totalMins)}h</TD>
                            <TD right mono>{fmtHrs(r.regularMins)}h</TD>
                            <TD right mono accent={r.dailyOtMins > 0 ? 'text-amber-400' : 'text-slate-500'}>
                              {r.dailyOtMins > 0 ? `${fmtHrs(r.dailyOtMins)}h` : '—'}
                            </TD>
                            <TD right mono accent={r.weeklyOtMins > 0 ? 'text-red-400' : 'text-slate-500'}>
                              {r.weeklyOtMins > 0 ? `${fmtHrs(r.weeklyOtMins)}h` : '—'}
                            </TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── BREAK COMPLIANCE TAB ──────────────────────────────────────── */}
          {tab === 'breaks' && (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700">
                <div>
                  <h2 className="font-semibold text-white text-sm">
                    Break Compliance — shifts ≥ {data?.breakRequiredHrs ?? 6} hours
                  </h2>
                  {breakRows.length > 0 && (() => {
                    const missed   = breakRows.filter(r => !r.hadBreak).length
                    const penalised = breakRows.filter(r => r.penaltyMins > 0).length
                    return (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {missed} missed break{missed !== 1 ? 's' : ''} · {penalised} penalt{penalised !== 1 ? 'ies' : 'y'} applied
                      </p>
                    )
                  })()}
                </div>
                <div className="flex gap-2">
                  <button onClick={exportBreakCSV}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                    ↓ CSV
                  </button>
                  <button onClick={exportBreakPDF}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                    ⎙ Print / PDF
                  </button>
                </div>
              </div>

              {breakRows.length === 0 ? (
                <p className="text-slate-500 text-center py-12">No long shifts in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-900/50">
                      <tr>
                        <TH>Employee</TH>
                        <TH>Date</TH>
                        <TH right>Shift Duration</TH>
                        <TH>Break Taken</TH>
                        <TH right>Penalty Added</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {breakRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                          <TD>{r.name}</TD>
                          <TD mono>{r.date}</TD>
                          <TD right mono>{fmtMins(r.grossMins)}</TD>
                          <TD>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              r.hadBreak
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}>
                              {r.hadBreak ? 'Yes' : 'No'}
                            </span>
                          </TD>
                          <TD right mono accent={r.penaltyMins > 0 ? 'text-red-400' : 'text-slate-600'}>
                            {r.penaltyMins > 0 ? `+${fmtMins(r.penaltyMins)}` : '—'}
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
