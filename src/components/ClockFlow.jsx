/**
 * ClockFlow — multi-step wizard that runs after PIN is verified.
 *
 * Step order:
 *  loading → blocked? → warning? → notification[]? → shift_edit[]?
 *          → structured_notification[]?
 *          → break_reminder?          (clocked_in, shift past reminder threshold, no break)
 *          → confirm_action (clocked_out) | action_select (clocked_in / on_break)
 *          → break_ack?               (clock_out chosen, shift past required threshold, no break)
 *          → executing → onDone(message)
 *
 * Props:
 *  employee  { user, status, since, openEntry, openBreak }
 *  storeId   number
 *  onDone(message)
 *  onCancel()
 */

import { useState, useEffect }                     from 'react'
import { runClockInRules, runClockOutRules }        from '../engine/rules'
import { getPendingAlerts, respondToAlert,
         getActiveNotificationsForTrigger,
         saveNotificationResponse }                 from '../engine/notifications'
import { checkBreakStatus, applyBreakPenalty }      from '../engine/breakCompliance'
import { clockIn, clockOut, startBreak, endBreak }  from '../db/actions'

// ── Icon helper ────────────────────────────────────────────────────────────
function Icon({ path, className = 'w-6 h-6' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
    </svg>
  )
}

const ICONS = {
  block:       'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  warn:        'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  bell:        'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  edit:        'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  clockIn:     'M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1',
  clockOut:    'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  coffee:      'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z',
  checkCircle: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
}

// ── Shared modal wrapper ───────────────────────────────────────────────────
function ModalCard({ children }) {
  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700
                   flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function ModalHeader({ icon, iconBg, title, subtitle }) {
  return (
    <div className="p-6 pb-4 text-center border-b border-slate-700">
      <div className={`w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>
      <h2 className="text-xl font-bold text-white">{title}</h2>
      {subtitle && <p className="text-slate-400 text-sm mt-1">{subtitle}</p>}
    </div>
  )
}

function BigBtn({ label, color, icon, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-4 rounded-xl font-bold text-white text-lg flex items-center
                  justify-center gap-3 transition-colors disabled:opacity-40
                  disabled:cursor-not-allowed ${color}`}
    >
      {icon}
      {label}
    </button>
  )
}

function CancelBtn({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3 rounded-xl text-slate-400 hover:text-white border border-slate-600
                 hover:border-slate-400 transition-colors disabled:opacity-40 text-sm"
    >
      Cancel
    </button>
  )
}

function ProgressDots({ current, total }) {
  if (total <= 1) return null
  return (
    <div className="flex justify-center gap-1.5 pt-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i === current ? 'bg-blue-400' : 'bg-slate-600'
          }`}
        />
      ))}
    </div>
  )
}

function Avatar({ user, status }) {
  const bg = status === 'clocked_in' ? 'bg-emerald-600' :
             status === 'on_break'   ? 'bg-amber-600'   : 'bg-slate-600'
  return (
    <div className={`w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center
                     text-2xl font-bold text-white ${bg}`}>
      {user.first_name[0]}{user.last_name[0]}
    </div>
  )
}

// ── Step views ─────────────────────────────────────────────────────────────

function LoadingView() {
  return (
    <ModalCard>
      <div className="p-12 flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400">Checking restrictions…</p>
      </div>
    </ModalCard>
  )
}

function BlockedView({ rules, onClose }) {
  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.block} className="w-7 h-7 text-white" />}
        iconBg="bg-red-600"
        title="Action Not Allowed"
        subtitle="This action is restricted"
      />
      <div className="p-6 space-y-3 overflow-y-auto">
        {rules.map((rule, i) => (
          <div key={rule.code ?? i} className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="font-semibold text-red-400">{rule.title}</p>
            <p className="text-sm text-slate-300 mt-1">{rule.message}</p>
          </div>
        ))}
      </div>
      <div className="p-6 pt-2">
        <button
          onClick={onClose}
          className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
        >
          Close
        </button>
      </div>
    </ModalCard>
  )
}

function WarningView({ rules, onProceed, onCancel }) {
  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.warn} className="w-7 h-7 text-white" />}
        iconBg="bg-amber-600"
        title="Attention Required"
        subtitle="Please review before proceeding"
      />
      <div className="p-6 space-y-3 overflow-y-auto">
        {rules.map(rule => (
          <div key={rule.code} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
            <p className="font-semibold text-amber-400">{rule.title}</p>
            <p className="text-sm text-slate-300 mt-1">{rule.message}</p>
          </div>
        ))}
      </div>
      <div className="p-6 pt-2 space-y-3">
        <BigBtn
          label="I Understand — Proceed"
          color="bg-amber-600 hover:bg-amber-500"
          icon={<Icon path={ICONS.warn} className="w-5 h-5" />}
          onClick={onProceed}
        />
        <CancelBtn onClick={onCancel} />
      </div>
    </ModalCard>
  )
}

function NotificationView({ alert, index, total, onRespond, onCancel, busy }) {
  const isQuestion = alert.type === 'question'
  const isUrgent   = alert.type === 'urgent'
  const headerBg   = isUrgent ? 'bg-red-600' : isQuestion ? 'bg-blue-600' : 'bg-slate-600'
  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.bell} className="w-7 h-7 text-white" />}
        iconBg={headerBg}
        title={alert.title || 'Notification'}
        subtitle={isUrgent ? 'Urgent — must acknowledge' : 'Please read and respond'}
      />
      <div className="p-6 overflow-y-auto">
        <p className="text-slate-200 leading-relaxed">{alert.message}</p>
        <ProgressDots current={index} total={total} />
      </div>
      <div className="p-6 pt-2 space-y-3">
        {isQuestion ? (
          <div className="grid grid-cols-2 gap-3">
            <BigBtn label="Yes" color="bg-emerald-600 hover:bg-emerald-500"
              onClick={() => onRespond('yes')} disabled={busy} />
            <BigBtn label="No"  color="bg-red-700 hover:bg-red-600"
              onClick={() => onRespond('no')}  disabled={busy} />
          </div>
        ) : (
          <BigBtn
            label={busy ? 'Saving…' : 'Acknowledge'}
            color="bg-blue-600 hover:bg-blue-500"
            icon={<Icon path={ICONS.checkCircle} className="w-5 h-5" />}
            onClick={() => onRespond('acknowledged')}
            disabled={busy}
          />
        )}
        <CancelBtn onClick={onCancel} disabled={busy} />
      </div>
    </ModalCard>
  )
}

function ShiftEditView({ alert, index, total, onAcknowledge, onCancel, busy }) {
  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.edit} className="w-7 h-7 text-white" />}
        iconBg="bg-violet-600"
        title="Shift Edit Notification"
        subtitle="A manager has edited one of your time entries"
      />
      <div className="p-6 overflow-y-auto">
        <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
          <p className="text-slate-200 leading-relaxed">{alert.message}</p>
        </div>
        <p className="text-slate-500 text-xs mt-3">Please review and acknowledge this change.</p>
        <ProgressDots current={index} total={total} />
      </div>
      <div className="p-6 pt-2 space-y-3">
        <BigBtn
          label={busy ? 'Saving…' : 'I Acknowledge'}
          color="bg-violet-600 hover:bg-violet-500"
          icon={<Icon path={ICONS.checkCircle} className="w-5 h-5" />}
          onClick={onAcknowledge}
          disabled={busy}
        />
        <CancelBtn onClick={onCancel} disabled={busy} />
      </div>
    </ModalCard>
  )
}

// key={structNotifIdx} on parent ensures local state resets between notifications
function StructuredNotificationView({ notif, index, total, onSubmit, onCancel, busy }) {
  const questions = JSON.parse(notif.questions || '[]')
  const [answers, setAnswers] = useState({})
  const [errors,  setErrors]  = useState({})

  function setAnswer(id, val) {
    setAnswers(a => ({ ...a, [id]: val }))
    setErrors(e => ({ ...e, [id]: false }))
  }

  function handleSubmit() {
    const errs = {}
    questions.forEach(q => {
      if (q.required && (answers[q.id] === undefined || answers[q.id] === '')) errs[q.id] = true
    })
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit(answers)
  }

  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.bell} className="w-7 h-7 text-white" />}
        iconBg="bg-indigo-600"
        title={notif.title || 'Notice'}
        subtitle={notif.is_required ? 'Required — respond before proceeding' : 'Please respond'}
      />
      <div className="p-6 overflow-y-auto space-y-5">
        {questions.length === 0 && (
          <p className="text-slate-300 leading-relaxed">Please acknowledge this notice to continue.</p>
        )}
        {questions.map(q => (
          <div key={q.id}>
            <label className="block text-sm font-medium text-slate-200 mb-2">
              {q.label}
              {q.required && <span className="text-red-400 ml-1">*</span>}
            </label>
            {q.type === 'yes_no' ? (
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setAnswer(q.id, 'yes')}
                  className={`py-3 rounded-xl font-semibold text-sm transition-colors ${
                    answers[q.id] === 'yes'
                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}>Yes</button>
                <button onClick={() => setAnswer(q.id, 'no')}
                  className={`py-3 rounded-xl font-semibold text-sm transition-colors ${
                    answers[q.id] === 'no'
                      ? 'bg-red-700 text-white ring-2 ring-red-400'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}>No</button>
              </div>
            ) : (
              <textarea rows={3}
                className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white text-sm
                            focus:outline-none focus:ring-1 resize-none ${
                  errors[q.id]
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-slate-600 focus:border-blue-500 focus:ring-blue-500'
                }`}
                placeholder="Type your response…"
                value={answers[q.id] || ''}
                onChange={e => setAnswer(q.id, e.target.value)}
              />
            )}
            {errors[q.id] && <p className="text-red-400 text-xs mt-1">This response is required</p>}
          </div>
        ))}
        <ProgressDots current={index} total={total} />
      </div>
      <div className="p-6 pt-2 space-y-3">
        <BigBtn
          label={busy ? 'Saving…' : questions.length === 0 ? 'Acknowledge & Continue' : 'Submit & Continue'}
          color="bg-indigo-600 hover:bg-indigo-500"
          icon={<Icon path={ICONS.checkCircle} className="w-5 h-5" />}
          onClick={handleSubmit}
          disabled={!!busy}
        />
        {!notif.is_required && <CancelBtn onClick={onCancel} disabled={!!busy} />}
      </div>
    </ModalCard>
  )
}

// ── Break reminder — proactive in-shift nudge ─────────────────────────────
function BreakReminderView({ shiftMinutes, onTakeBreak, onSkip, busy }) {
  const h       = Math.floor(shiftMinutes / 60)
  const m       = Math.round(shiftMinutes % 60)
  const elapsed = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.coffee} className="w-7 h-7 text-white" />}
        iconBg="bg-amber-600"
        title="Break Reminder"
        subtitle={`On shift ${elapsed} with no break recorded`}
      />
      <div className="p-6">
        <p className="text-slate-300 text-sm leading-relaxed">
          It looks like you haven't taken a meal break yet. Would you like to
          start your break now, or continue to the other clock options?
        </p>
      </div>
      <div className="p-6 pt-2 space-y-3">
        <BigBtn
          label={busy === 'start_break' ? 'Starting Break…' : 'Take Break Now'}
          color="bg-amber-600 hover:bg-amber-500"
          icon={<Icon path={ICONS.coffee} className="w-5 h-5" />}
          onClick={onTakeBreak}
          disabled={!!busy}
        />
        <BigBtn
          label="Skip — Continue"
          color="bg-slate-700 hover:bg-slate-600"
          onClick={onSkip}
          disabled={!!busy}
        />
      </div>
    </ModalCard>
  )
}

// ── Break acknowledgment — compliance gate at clock-out ───────────────────
function BreakAckView({ penaltyEnabled, penaltyMinutes, onYes, onNo, busy }) {
  return (
    <ModalCard>
      <ModalHeader
        icon={<Icon path={ICONS.coffee} className="w-7 h-7 text-white" />}
        iconBg="bg-blue-600"
        title="Meal Break Confirmation"
        subtitle="Required before clocking out"
      />
      <div className="p-6 space-y-3">
        <p className="text-slate-300 text-sm leading-relaxed">
          Did you take a meal break during this shift?
        </p>
        {penaltyEnabled && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <p className="text-amber-400 text-xs leading-relaxed">
              If you did not take a meal break, a {penaltyMinutes}-minute penalty will be
              added to your total worked hours and recorded in the audit log.
            </p>
          </div>
        )}
      </div>
      <div className="p-6 pt-2 space-y-3">
        <BigBtn
          label={busy ? 'Clocking Out…' : 'Yes — I Took a Break'}
          color="bg-emerald-600 hover:bg-emerald-500"
          icon={busy
            ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Icon path={ICONS.checkCircle} className="w-5 h-5" />
          }
          onClick={onYes}
          disabled={!!busy}
        />
        <BigBtn
          label={busy ? 'Clocking Out…'
            : penaltyEnabled
              ? `No — Add ${penaltyMinutes}m Penalty & Clock Out`
              : 'No — Clock Out Without Break'}
          color="bg-slate-700 hover:bg-slate-600"
          onClick={onNo}
          disabled={!!busy}
        />
      </div>
    </ModalCard>
  )
}

function ConfirmClockInView({ user, onConfirm, onCancel, busy }) {
  return (
    <ModalCard>
      <div className="p-6 text-center">
        <Avatar user={user} status="clocked_out" />
        <h2 className="text-xl font-bold text-white">{user.first_name} {user.last_name}</h2>
        <p className="text-slate-400 text-sm mt-1">Ready to clock in?</p>
      </div>
      <div className="p-6 pt-2 space-y-3">
        <BigBtn
          label={busy ? 'Clocking In…' : 'Clock In'}
          color="bg-emerald-600 hover:bg-emerald-500"
          icon={busy
            ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Icon path={ICONS.clockIn} className="w-5 h-5" />
          }
          onClick={onConfirm}
          disabled={busy}
        />
        <CancelBtn onClick={onCancel} disabled={busy} />
      </div>
    </ModalCard>
  )
}

function ActionSelectView({ employee, onAction, onCancel, busy, minBreakRemaining }) {
  const { user, status, since } = employee
  const elapsed = since
    ? (() => {
        const s = Math.floor((Date.now() - new Date(since).getTime()) / 1000)
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
        return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}m`
      })()
    : null

  return (
    <ModalCard>
      <div className="p-6 text-center">
        <Avatar user={user} status={status} />
        <h2 className="text-xl font-bold text-white">{user.first_name} {user.last_name}</h2>
        {elapsed && (
          <p className="text-slate-400 text-sm mt-1 font-mono">
            {status === 'clocked_in' ? 'On clock' : 'On break'} · {elapsed}
          </p>
        )}
      </div>
      <div className="p-6 pt-0 space-y-3">
        {status === 'clocked_in' && (
          <BigBtn
            label={busy === 'start_break' ? 'Starting Break…' : 'Start Break'}
            color="bg-amber-600 hover:bg-amber-500"
            icon={<Icon path={ICONS.coffee} className="w-5 h-5" />}
            onClick={() => onAction('start_break')}
            disabled={!!busy}
          />
        )}
        {status === 'on_break' && (
          <div>
            <BigBtn
              label={busy === 'end_break' ? 'Ending Break…' : 'End Break'}
              color="bg-blue-600 hover:bg-blue-500"
              icon={<Icon path={ICONS.checkCircle} className="w-5 h-5" />}
              onClick={() => onAction('end_break')}
              disabled={!!busy || minBreakRemaining > 0}
            />
            {minBreakRemaining > 0 && (
              <p className="text-center text-amber-400 text-xs mt-2">
                Minimum break is 30 min — {minBreakRemaining} min remaining
              </p>
            )}
          </div>
        )}
        <BigBtn
          label={busy === 'clock_out' ? 'Clocking Out…' : 'Clock Out'}
          color="bg-red-700 hover:bg-red-600"
          icon={<Icon path={ICONS.clockOut} className="w-5 h-5" />}
          onClick={() => onAction('clock_out')}
          disabled={!!busy}
        />
        <CancelBtn onClick={onCancel} disabled={!!busy} />
      </div>
    </ModalCard>
  )
}

// ── Main ClockFlow component ───────────────────────────────────────────────
export default function ClockFlow({ employee, storeId, onDone, onCancel }) {
  const [step,           setStep]           = useState('loading')
  const [blockRules,     setBlockRules]     = useState([])
  const [warnRules,      setWarnRules]      = useState([])
  const [notifications,  setNotifications]  = useState([])
  const [notifIdx,       setNotifIdx]       = useState(0)
  const [shiftEdits,     setShiftEdits]     = useState([])
  const [editIdx,        setEditIdx]        = useState(0)
  const [structNotifs,   setStructNotifs]   = useState([])
  const [structNotifIdx, setStructNotifIdx] = useState(0)
  const [breakStatus,    setBreakStatus]    = useState(null)
  const [busy,           setBusy]           = useState(false)

  // ── Run all checks on mount ───────────────────────────────────────────────
  useEffect(() => {
    async function runChecks() {
      const trigger = employee.status === 'clocked_out' ? 'clock_in'  :
                      employee.status === 'on_break'    ? 'end_break'  : 'clock_out'

      const [rules, alerts, structuredNotifs, brkStatus] = await Promise.all([
        employee.status === 'clocked_out'
          ? runClockInRules(employee.user, storeId)
          : runClockOutRules(employee.user, employee.openEntry, storeId),
        getPendingAlerts(employee.user.id, employee.user.role_id, storeId),
        getActiveNotificationsForTrigger(employee.user.id, employee.user.role_id, storeId, trigger),
        employee.status !== 'clocked_out'
          ? checkBreakStatus(employee.openEntry, storeId, employee.user)
          : Promise.resolve({ shouldRemindBreak: false, needsBreakAck: false,
              hasBreak: false, penaltyEnabled: false, penaltyMinutes: 60, shiftMinutes: 0 }),
      ])

      const blocks = rules.filter(r => r.type === 'block')
      const warns  = rules.filter(r => r.type !== 'block')

      setBlockRules(blocks)
      setWarnRules(warns)
      setNotifications(alerts.notifications)
      setShiftEdits(alerts.shiftEdits)
      setStructNotifs(structuredNotifs)
      setBreakStatus(brkStatus)

      if (blocks.length)                       setStep('blocked')
      else if (warns.length)                   setStep('warning')
      else if (alerts.notifications.length)    setStep('notification')
      else if (alerts.shiftEdits.length)       setStep('shift_edit')
      else if (structuredNotifs.length)        setStep('structured_notification')
      else if (brkStatus.shouldRemindBreak)    setStep('break_reminder')
      else                                     setStep(nextActionStep(employee.status))
    }

    runChecks().catch(() => setStep(nextActionStep(employee.status)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step helpers ──────────────────────────────────────────────────────────
  function nextActionStep(status) {
    return status === 'clocked_out' ? 'confirm_action' : 'action_select'
  }

  function goToBreakReminderOrAction() {
    if (breakStatus?.shouldRemindBreak) setStep('break_reminder')
    else setStep(nextActionStep(employee.status))
  }

  function advanceAfterWarning() {
    if (notifications.length)    { setStep('notification');            setNotifIdx(0) }
    else if (shiftEdits.length)  { setStep('shift_edit');             setEditIdx(0) }
    else if (structNotifs.length){ setStep('structured_notification'); setStructNotifIdx(0) }
    else goToBreakReminderOrAction()
  }

  function advanceAfterNotification(idx) {
    const next = idx + 1
    if (next < notifications.length) { setNotifIdx(next) }
    else if (shiftEdits.length)      { setStep('shift_edit'); setEditIdx(0) }
    else if (structNotifs.length)    { setStep('structured_notification'); setStructNotifIdx(0) }
    else goToBreakReminderOrAction()
  }

  function advanceAfterShiftEdit(idx) {
    const next = idx + 1
    if (next < shiftEdits.length)  { setEditIdx(next) }
    else if (structNotifs.length)  { setStep('structured_notification'); setStructNotifIdx(0) }
    else goToBreakReminderOrAction()
  }

  function advanceAfterStructNotif(idx) {
    const next = idx + 1
    if (next < structNotifs.length) { setStructNotifIdx(next) }
    else goToBreakReminderOrAction()
  }

  // ── Response handlers ─────────────────────────────────────────────────────
  async function handleNotifResponse(response) {
    setBusy(true)
    try {
      await respondToAlert(notifications[notifIdx].id, employee.user.id, response)
      advanceAfterNotification(notifIdx)
    } finally { setBusy(false) }
  }

  async function handleEditAck() {
    setBusy(true)
    try {
      await respondToAlert(shiftEdits[editIdx].id, employee.user.id, 'acknowledged')
      advanceAfterShiftEdit(editIdx)
    } finally { setBusy(false) }
  }

  async function handleStructNotifSubmit(answers) {
    setBusy(true)
    try {
      const notif       = structNotifs[structNotifIdx]
      const timeEntryId = employee.openEntry?.id ?? null
      const results     = await saveNotificationResponse(
        notif, employee.user.id, storeId, timeEntryId, answers
      )
      const blocks = results.filter(r => r.type === 'block')
      if (blocks.length) {
        setBlockRules(prev => [
          ...prev,
          ...blocks.map(b => ({ code: 'notification_block', title: notif.title, message: b.message })),
        ])
        setStep('blocked')
      } else {
        advanceAfterStructNotif(structNotifIdx)
      }
    } finally { setBusy(false) }
  }

  // ── Break action handlers ─────────────────────────────────────────────────

  // Intercepts clock_out from action_select — shows break_ack if needed
  function handleAction(action) {
    if (action === 'clock_out' && breakStatus?.needsBreakAck) {
      setStep('break_ack')
    } else {
      executeAction(action)
    }
  }

  async function handleBreakAckYes() {
    // Employee confirms they took a break — proceed to clock out
    executeAction('clock_out')
  }

  async function handleBreakAckNo() {
    // Employee admits no break — apply penalty if configured, then clock out
    setBusy('clock_out')
    const { user, openEntry } = employee
    try {
      if (breakStatus?.penaltyEnabled) {
        await applyBreakPenalty(openEntry, user.id, storeId, breakStatus.penaltyMinutes)
      }
      await clockOut(openEntry.id, user.id, storeId)
      onDone(`${user.first_name} — Clocked out!`)
    } catch (err) {
      console.error('Clock out failed:', err)
      setBusy(false)
    }
  }

  // ── Execute clock action ──────────────────────────────────────────────────
  async function executeAction(action) {
    setBusy(action)
    const { user, openEntry, openBreak } = employee
    try {
      switch (action) {
        case 'clock_in':    await clockIn(user.id, storeId);                 break
        case 'clock_out':   await clockOut(openEntry.id, user.id, storeId);  break
        case 'start_break': await startBreak(openEntry.id, user.id);         break
        case 'end_break':   await endBreak(openBreak.id, user.id, storeId);  break
      }
      const labels = {
        clock_in:    'Clocked in',
        clock_out:   'Clocked out',
        start_break: 'Break started',
        end_break:   'Back from break',
      }
      onDone(`${user.first_name} — ${labels[action]}!`)
    } catch (err) {
      console.error('Clock action failed:', err)
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (step === 'loading') return <LoadingView />

  if (step === 'blocked')
    return <BlockedView rules={blockRules} onClose={onCancel} />

  if (step === 'warning')
    return <WarningView rules={warnRules} onProceed={advanceAfterWarning} onCancel={onCancel} />

  if (step === 'notification')
    return (
      <NotificationView
        alert={notifications[notifIdx]}
        index={notifIdx}
        total={notifications.length}
        onRespond={handleNotifResponse}
        onCancel={onCancel}
        busy={busy}
      />
    )

  if (step === 'shift_edit')
    return (
      <ShiftEditView
        alert={shiftEdits[editIdx]}
        index={editIdx}
        total={shiftEdits.length}
        onAcknowledge={handleEditAck}
        onCancel={onCancel}
        busy={busy}
      />
    )

  if (step === 'structured_notification')
    return (
      <StructuredNotificationView
        key={structNotifIdx}
        notif={structNotifs[structNotifIdx]}
        index={structNotifIdx}
        total={structNotifs.length}
        onSubmit={handleStructNotifSubmit}
        onCancel={onCancel}
        busy={busy}
      />
    )

  if (step === 'break_reminder')
    return (
      <BreakReminderView
        shiftMinutes={breakStatus?.shiftMinutes ?? 0}
        onTakeBreak={() => executeAction('start_break')}
        onSkip={() => setStep(nextActionStep(employee.status))}
        busy={busy}
      />
    )

  if (step === 'confirm_action')
    return (
      <ConfirmClockInView
        user={employee.user}
        onConfirm={() => executeAction('clock_in')}
        onCancel={onCancel}
        busy={!!busy}
      />
    )

  if (step === 'action_select')
    return (
      <ActionSelectView
        employee={employee}
        onAction={handleAction}
        onCancel={onCancel}
        busy={busy}
        minBreakRemaining={breakStatus?.minBreakRemaining ?? 0}
      />
    )

  if (step === 'break_ack')
    return (
      <BreakAckView
        penaltyEnabled={breakStatus?.penaltyEnabled ?? false}
        penaltyMinutes={breakStatus?.penaltyMinutes ?? 60}
        onYes={handleBreakAckYes}
        onNo={handleBreakAckNo}
        busy={busy}
      />
    )

  return null
}
