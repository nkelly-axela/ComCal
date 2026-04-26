/**
 * src/components/LeaveUserPanel.jsx
 * ─────────────────────────────────────────────────────────────
 * Employee-facing leave panel.
 *   - Balance cards (one per leave type) sourced from v_leave_balances
 *     filtered to the current user + selected year.
 *   - Recent requests (their own, ordered by start_date desc).
 *   - "Request leave" modal that inserts into leave_requests with
 *     status 'pending' and a client-computed business-day count.
 *   - Cancel button on pending requests (sets status='cancelled').
 *
 * Props: { userId, userRole, fullName }
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

// Mirrors public.calculate_leave_days from migration_02 — counts
// weekdays inclusive, ignores public holidays. Kept client-side
// so the modal shows the day count live as the user picks dates.
function calcBusinessDays(startStr, endStr) {
  if (!startStr || !endStr) return 0
  const s = new Date(startStr)
  const e = new Date(endStr)
  if (isNaN(s) || isNaN(e) || e < s) return 0
  let days = 0
  const cursor = new Date(s)
  while (cursor <= e) {
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) days++
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS_VARIANTS = {
  pending:   { variant: 'amber', label: 'Pending' },
  approved:  { variant: 'green', label: 'Approved' },
  rejected:  { variant: 'red',   label: 'Rejected' },
  cancelled: { variant: 'gray',  label: 'Cancelled' },
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function LeaveUserPanel({ userId, fullName }) {
  const currentYear = new Date().getFullYear()

  const [balances, setBalances] = useState([])
  const [requests, setRequests] = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
  const [loading, setLoading] = useState(true)

  const [reqModal, setReqModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ typeId: '', start: '', end: '', reason: '', isHourly: false, hours: '1', hourDate: '' })
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Loaders ──────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_leave_balances')
      .select('*')
      .eq('user_id', userId)
      .eq('year', currentYear)
    if (error) showToast(error.message, 'error')
    else setBalances(data ?? [])
  }, [userId, currentYear])

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id, leave_type_id, start_date, end_date, days_requested, hours_requested, status, reason, admin_note, created_at, leave_types(name, color)')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(50)
    if (error) showToast(error.message, 'error')
    else setRequests(data ?? [])
  }, [userId])

  const loadLeaveTypes = useCallback(async () => {
    const { data, error } = await supabase
      .from('leave_types')
      .select('id, name, color, requires_approval, max_days_per_year')
      .order('name')
    if (error) showToast(error.message, 'error')
    else setLeaveTypes(data ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadBalances(), loadRequests(), loadLeaveTypes()]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [loadBalances, loadRequests, loadLeaveTypes])

  // ── Submit a new request ─────────────────────────────────────
  const submitRequest = async () => {
    if (!form.typeId) { showToast('Pick a leave type', 'error'); return }

    if (form.isHourly) {
      if (!form.hourDate) { showToast('Pick a date for your hourly request', 'error'); return }
      const hrs = parseFloat(form.hours)
      if (!hrs || hrs <= 0 || hrs > 8) { showToast('Enter between 1 and 8 hours', 'error'); return }
      setBusy(true)
      try {
        const { error } = await supabase.from('leave_requests').insert({
          user_id: userId,
          leave_type_id: form.typeId,
          start_date: form.hourDate,
          end_date: form.hourDate,
          days_requested: 0,
          hours_requested: hrs,
          reason: form.reason || null,
          status: 'pending',
        })
        if (error) throw error
        showToast('Request submitted')
        setReqModal(false)
        setForm({ typeId: '', start: '', end: '', reason: '', isHourly: false, hours: '1', hourDate: '' })
        await loadRequests()
      } catch (e) {
        showToast(e.message, 'error')
      } finally {
        setBusy(false)
      }
      return
    }

    if (!form.start || !form.end) { showToast('Pick both dates', 'error'); return }
    if (new Date(form.end) < new Date(form.start)) {
      showToast('End date can\'t be before start date', 'error'); return
    }
    const days = calcBusinessDays(form.start, form.end)
    if (days <= 0) { showToast('That range has no working days', 'error'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('leave_requests').insert({
        user_id: userId,
        leave_type_id: form.typeId,
        start_date: form.start,
        end_date: form.end,
        days_requested: days,
        hours_requested: null,
        reason: form.reason || null,
        status: 'pending',
      })
      if (error) throw error
      showToast('Request submitted')
      setReqModal(false)
      setForm({ typeId: '', start: '', end: '', reason: '', isHourly: false, hours: '1', hourDate: '' })
      await loadRequests()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Cancel a pending request ─────────────────────────────────
  const cancelRequest = async (id) => {
    if (!window.confirm('Cancel this request?')) return
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('user_id', userId)        // belt-and-braces — RLS should also enforce this
      .eq('status', 'pending')      // never overwrite an approved/rejected row
    if (error) { showToast(error.message, 'error'); return }
    showToast('Request cancelled')
    await Promise.all([loadRequests(), loadBalances()])
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  const previewDays = calcBusinessDays(form.start, form.end)

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#111', position: 'relative' }}>

      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 100,
          background: toast.type === 'error' ? '#fee2e2' : '#d1fae5',
          color: toast.type === 'error' ? '#991b1b' : '#065f46',
          padding: '0.6rem 1rem', borderRadius: 8, fontSize: 13,
          border: `0.5px solid ${toast.type === 'error' ? '#fca5a5' : '#6ee7b7'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>{toast.msg}</div>
      )}

      <div style={{
        background: '#fff', borderRadius: 12,
        border: '0.5px solid #e5e7eb', padding: '1.5rem',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>Hi, {fullName?.split(' ')[0] ?? 'there'}</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Your leave for {currentYear}</div>
          </div>
          <Btn variant="primary" size="sm" onClick={() => {
            setForm({ typeId: leaveTypes[0]?.id ?? '', start: '', end: '', reason: '', isHourly: false, hours: '1', hourDate: '' })
            setReqModal(true)
          }}>+ Request leave</Btn>
        </div>

        {/* Balance cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: '1.75rem' }}>
          {loading
            ? <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading balances…</div>
            : balances.length === 0
              ? <div style={{ color: '#9ca3af', fontSize: 13 }}>
                  No allowances seeded for {currentYear} yet. Ask an admin to run the seed.
                </div>
              : balances.map(b => <BalanceCard key={`${b.leave_type_id}-${b.year}`} b={b} />)
          }
        </div>

        {/* Requests */}
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: '0.75rem' }}>Your requests</div>
        <Table headers={['Type', 'Dates', 'Duration', 'Status', 'Admin note', 'Actions']} empty="No requests yet">
          {requests.map(r => {
            const meta = STATUS_VARIANTS[r.status] ?? { variant: 'gray', label: r.status }
            return (
              <TR key={r.id}>
                <TD>
                  <Swatch color={r.leave_types?.color} />
                  {r.leave_types?.name ?? 'Unknown'}
                </TD>
                <TD>
                  <div>
                    {r.hours_requested
                      ? fmtDate(r.start_date)
                      : <>{fmtDate(r.start_date)}{r.start_date !== r.end_date && <> → {fmtDate(r.end_date)}</>}</>}
                  </div>
                  {r.reason && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{r.reason}</div>}
                </TD>
                <TD>
                  {r.hours_requested
                    ? <>{r.hours_requested}h</>
                    : <>{r.days_requested} day{r.days_requested === 1 ? '' : 's'}</>}
                </TD>
                <TD><Badge variant={meta.variant}>{meta.label}</Badge></TD>
                <TD style={{ maxWidth: 160 }}>
                  {r.admin_note
                    ? <span style={{
                        fontSize: 12,
                        color: r.status === 'rejected' ? '#991b1b' : '#065f46',
                        background: r.status === 'rejected' ? '#fee2e2' : '#d1fae5',
                        padding: '2px 8px', borderRadius: 6,
                      }}>{r.admin_note}</span>
                    : <span style={{ color: '#d1d5db' }}>—</span>}
                </TD>
                <TD>
                  {r.status === 'pending'
                    ? <Btn size="sm" variant="danger" onClick={() => cancelRequest(r.id)}>Cancel</Btn>
                    : <span style={{ color: '#d1d5db' }}>—</span>}
                </TD>
              </TR>
            )
          })}
        </Table>
      </div>

      {/* Modal */}
      <Modal open={reqModal} onClose={() => setReqModal(false)} title="Request leave">
        <Field label="Leave type">
          <select style={inputStyle} value={form.typeId} onChange={e => setForm(f => ({ ...f, typeId: e.target.value }))}>
            <option value="">Select…</option>
            {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
          </select>
        </Field>

        {/* Hourly / full-day toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '0.85rem', padding: '0.5rem 0.65rem',
          background: '#f9fafb', borderRadius: 8, border: '0.5px solid #e5e7eb',
        }}>
          <span style={{ fontSize: 13, color: '#374151' }}>Request by the hour</span>
          <label style={{ position: 'relative', display: 'inline-block', width: 32, height: 18, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isHourly} onChange={e => setForm(f => ({ ...f, isHourly: e.target.checked }))}
              style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{
              position: 'absolute', inset: 0,
              background: form.isHourly ? '#1D9E75' : '#d1d5db',
              borderRadius: 9, transition: '.2s',
            }}>
              <span style={{
                position: 'absolute', width: 12, height: 12,
                left: form.isHourly ? 17 : 3, top: 3,
                background: '#fff', borderRadius: '50%', transition: '.2s',
              }} />
            </span>
          </label>
        </div>

        {form.isHourly ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Date">
              <input style={inputStyle} type="date" value={form.hourDate}
                onChange={e => setForm(f => ({ ...f, hourDate: e.target.value }))} />
            </Field>
            <Field label="Hours (1–8)">
              <select style={inputStyle} value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}>
                {[1,2,3,4,5,6,7,8].map(h => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}
              </select>
            </Field>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Start">
              <input style={inputStyle} type="date" value={form.start}
                onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />
            </Field>
            <Field label="End">
              <input style={inputStyle} type="date" value={form.end} min={form.start || undefined}
                onChange={e => setForm(f => ({ ...f, end: e.target.value }))} />
            </Field>
          </div>
        )}
        <Field label="Reason (optional)">
          <textarea
            value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            rows={3}
            placeholder="Anything your manager should know"
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>
        <div style={{
          background: '#f9fafb', border: '0.5px solid #e5e7eb', borderRadius: 8,
          padding: '0.6rem 0.75rem', fontSize: 12, color: '#374151',
          marginBottom: '0.85rem',
        }}>
          {form.isHourly
            ? form.hourDate && form.hours
              ? <>This will use <strong>{form.hours} hour{+form.hours > 1 ? 's' : ''}</strong> of leave on {fmtDate(form.hourDate)}.</>
              : <>Pick a date and number of hours.</>
            : previewDays > 0
              ? <>This will use <strong>{previewDays}</strong> business day{previewDays === 1 ? '' : 's'}.</>
              : <>Pick a date range to see the day count.</>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
          <Btn size="sm" onClick={() => setReqModal(false)}>Cancel</Btn>
          <Btn size="sm" variant="primary" onClick={submitRequest} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Local UI primitives (kept self-contained so this file is portable)
// ═══════════════════════════════════════════════════════════════

function BalanceCard({ b }) {
  const pct = b.total_days > 0 ? Math.round((b.used_days / b.total_days) * 100) : 0
  const fill = pct > 80 ? '#E24B4A' : pct > 50 ? '#EF9F27' : '#1D9E75'
  return (
    <div style={{
      background: '#f9fafb', borderRadius: 10,
      border: '0.5px solid #e5e7eb',
      padding: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Swatch color={b.color} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>{b.leave_type}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 26, fontWeight: 600 }}>{b.remaining_days}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>of {b.total_days} days left</div>
      </div>
      <div style={{ height: 5, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginTop: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: fill }} />
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
        {b.used_days} used · {b.year}
      </div>
    </div>
  )
}

const Swatch = ({ color }) => (
  <span style={{
    display: 'inline-block', width: 10, height: 10, borderRadius: 3,
    background: color ?? '#9CA3AF', flexShrink: 0,
  }} />
)

const Badge = ({ children, variant = 'gray' }) => {
  const styles = {
    green: { background: '#E1F5EE', color: '#0F6E56' },
    amber: { background: '#FAEEDA', color: '#854F0B' },
    gray:  { background: '#F1EFE8', color: '#5F5E5A' },
    red:   { background: '#FCEBEB', color: '#A32D2D' },
    blue:  { background: '#E6F1FB', color: '#185FA5' },
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 500,
      ...styles[variant],
    }}>{children}</span>
  )
}

const Btn = ({ children, onClick, variant = 'default', size = 'md', disabled, type = 'button' }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: size === 'sm' ? 12 : 13,
    padding: size === 'sm' ? '0.3rem 0.65rem' : '0.45rem 0.9rem',
    borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', transition: 'all .15s', border: '0.5px solid #d1d5db',
    opacity: disabled ? 0.5 : 1,
  }
  const variants = {
    default: { background: 'transparent', color: '#111' },
    primary: { background: '#1D9E75', border: '0.5px solid #1D9E75', color: '#fff' },
    danger:  { background: 'transparent', border: '0.5px solid #fca5a5', color: '#991b1b' },
  }
  return (
    <button type={type} onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  )
}

const inputStyle = {
  width: '100%', fontSize: 13, padding: '0.45rem 0.65rem',
  border: '0.5px solid #d1d5db', borderRadius: 8,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: '0.85rem' }}>
    <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</label>
    {children}
  </div>
)

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, border: '0.5px solid #e5e7eb',
        padding: '1.5rem', width: 420, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

const Table = ({ headers, children, empty }) => (
  <div style={{ border: '0.5px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} style={{
              textAlign: 'left', padding: '0.6rem 0.75rem',
              fontSize: 11, fontWeight: 500, color: '#6b7280',
              borderBottom: '0.5px solid #e5e7eb',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: '#fafafa',
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {children}
        {!children || (Array.isArray(children) && children.filter(Boolean).length === 0) ? (
          <tr><td colSpan={headers.length} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', fontSize: 13 }}>{empty}</td></tr>
        ) : null}
      </tbody>
    </table>
  </div>
)

const TR = ({ children }) => (
  <tr style={{ borderBottom: '0.5px solid #f3f4f6' }}
    onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
    onMouseLeave={e => e.currentTarget.style.background = ''}>
    {children}
  </tr>
)

const TD = ({ children, style }) => (
  <td style={{ padding: '0.7rem 0.75rem', verticalAlign: 'middle', ...style }}>{children}</td>
)
