/**
 * src/components/LeaveReportsPanel.jsx
 * ─────────────────────────────────────────────────────────────
 * Admin-only reporting panel.
 *   - Date range picker (from / to)
 *   - Status filter: pending | approved | rejected | all
 *   - Live table preview: employee, type, dates, duration,
 *     reason, admin note, status
 *   - Download as CSV
 *
 * Only rendered when the logged-in user has role admin/manager
 * (enforced by the parent App.jsx via the isAdmin check, and
 * by RLS on leave_requests).
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────

const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const fmtDuration = (r) => {
  if (r.hours_requested) return `${r.hours_requested}h`
  const d = r.days_requested ?? 0
  return `${d} day${d === 1 ? '' : 's'}`
}

const STATUS_STYLE = {
  pending:   { background: '#FAEEDA', color: '#854F0B' },
  approved:  { background: '#E1F5EE', color: '#0F6E56' },
  rejected:  { background: '#FCEBEB', color: '#A32D2D' },
  cancelled: { background: '#F1EFE8', color: '#5F5E5A' },
}

const today = () => new Date().toISOString().slice(0, 10)
const firstOfYear = () => `${new Date().getFullYear()}-01-01`

// ─── CSV export ───────────────────────────────────────────────

function toCSV(rows) {
  const headers = [
    'Employee', 'Role', 'Leave Type', 'Start Date', 'End Date',
    'Duration', 'Reason', 'Admin Note', 'Status', 'Submitted',
  ]
  const escape = (v) => {
    if (v == null) return ''
    const s = String(v).replace(/"/g, '""')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
  }
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      r.user?.full_name ?? '',
      r.user?.role ?? '',
      r.leave_types?.name ?? '',
      r.start_date ?? '',
      r.end_date ?? '',
      fmtDuration(r),
      r.reason ?? '',
      r.admin_note ?? '',
      r.status ?? '',
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : '',
    ].map(escape).join(',')),
  ]
  return lines.join('\r\n')
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function LeaveReportsPanel() {
  const [fromDate, setFromDate] = useState(firstOfYear())
  const [toDate, setToDate]     = useState(today())
  const [statusFilter, setStatusFilter] = useState('all')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [employees, setEmployees] = useState([])
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(false)
  const [ran, setRan]           = useState(false)
  const [toast, setToast]       = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name')
      .order('full_name')
      .then(({ data }) => setEmployees(data ?? []))
  }, [])

  // ── Run report ───────────────────────────────────────────────
  const runReport = useCallback(async () => {
    if (!fromDate || !toDate) { showToast('Set both a from and to date', 'error'); return }
    if (toDate < fromDate) { showToast('To date must be after from date', 'error'); return }
    setLoading(true)
    setRan(false)
    try {
      let query = supabase
        .from('leave_requests')
        .select(`
          id, start_date, end_date, days_requested, hours_requested,
          status, reason, admin_note, created_at,
          leave_types ( name, color ),
          user:users!leave_requests_user_id_fkey ( id, full_name, role )
        `)
        .gte('start_date', fromDate)
        .lte('start_date', toDate)
        .order('start_date', { ascending: false })

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (employeeFilter !== 'all') {
        query = query.eq('user_id', employeeFilter)
      }

      const { data, error } = await query
      if (error) throw error
      setRows(data ?? [])
      setRan(true)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, statusFilter, employeeFilter])

  // ── Download ─────────────────────────────────────────────────
  const handleDownload = () => {
    if (!rows.length) { showToast('Run the report first', 'error'); return }
    const csv = toCSV(rows)
    const label = statusFilter === 'all' ? 'all' : statusFilter
    const empLabel = employeeFilter === 'all'
      ? 'all-employees'
      : (employees.find(e => e.id === employeeFilter)?.full_name ?? 'employee').replace(/\s+/g, '-').toLowerCase()
    const filename = `leave-report_${empLabel}_${label}_${fromDate}_to_${toDate}.csv`
    downloadCSV(csv, filename)
    showToast(`Downloaded ${rows.length} row${rows.length === 1 ? '' : 's'} as CSV`)
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  const statusCounts = ran ? {
    all: rows.length,
    approved: rows.filter(r => r.status === 'approved').length,
    pending:  rows.filter(r => r.status === 'pending').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  } : null

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#111', position: 'relative' }}>

      {toast && (
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 100,
          background: toast.type === 'error' ? '#fee2e2' : '#d1fae5',
          color: toast.type === 'error' ? '#991b1b' : '#065f46',
          padding: '0.6rem 1rem', borderRadius: 8, fontSize: 13,
          border: `0.5px solid ${toast.type === 'error' ? '#fca5a5' : '#6ee7b7'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>{toast.msg}</div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Reports</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            Pull leave data for any date range and export as CSV
          </div>
        </div>
        <Btn variant="primary" onClick={handleDownload} disabled={!ran || !rows.length}>
          ↓ Download CSV
        </Btn>
      </div>

      {/* ── Filters ── */}
      <div style={{
        background: '#f9fafb', border: '0.5px solid #e5e7eb',
        borderRadius: 10, padding: '1rem 1.25rem',
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end',
        marginBottom: '1.25rem',
      }}>
        <Field label="From">
          <input
            type="date" value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="To">
          <input
            type="date" value={toDate} min={fromDate}
            onChange={e => setToDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Employee">
          <select
            value={employeeFilter}
            onChange={e => setEmployeeFilter(e.target.value)}
            style={{ ...inputStyle, minWidth: 160 }}
          >
            <option value="all">All employees</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <div style={{ display: 'flex', gap: 4, padding: 3, background: '#fff', borderRadius: 8, border: '0.5px solid #e5e7eb' }}>
            {['all', 'approved', 'pending', 'rejected'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                fontSize: 12, padding: '0.3rem 0.7rem', border: 'none', cursor: 'pointer',
                background: statusFilter === s ? (
                  s === 'approved' ? '#1D9E75' : s === 'rejected' ? '#E24B4A' : s === 'pending' ? '#EF9F27' : '#111'
                ) : 'transparent',
                color: statusFilter === s ? '#fff' : '#6b7280',
                borderRadius: 6, fontFamily: 'inherit',
                fontWeight: statusFilter === s ? 500 : 400,
                textTransform: 'capitalize',
                transition: 'all .15s',
              }}>{s}</button>
            ))}
          </div>
        </Field>
        <div style={{ paddingBottom: 1 }}>
          <Btn variant="primary" onClick={runReport} disabled={loading}>
            {loading ? 'Running…' : 'Run report'}
          </Btn>
        </div>
      </div>

      {/* ── Summary stats ── */}
      {ran && statusCounts && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
          marginBottom: '1.25rem',
        }}>
          {[
            { label: 'Total requests', val: statusCounts.all, color: '#111' },
            { label: 'Approved', val: statusCounts.approved, color: '#1D9E75' },
            { label: 'Pending', val: statusCounts.pending, color: '#EF9F27' },
            { label: 'Rejected', val: statusCounts.rejected, color: '#E24B4A' },
          ].map(s => (
            <div key={s.label} style={{
              background: '#fff', border: '0.5px solid #e5e7eb',
              borderRadius: 8, padding: '0.75rem 1rem',
            }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {!ran && !loading && (
        <div style={{
          border: '0.5px dashed #e5e7eb', borderRadius: 10,
          padding: '3rem', textAlign: 'center',
          color: '#9ca3af', fontSize: 13,
        }}>
          Set your filters above and click <strong>Run report</strong> to see results.
        </div>
      )}

      {loading && (
        <div style={{
          border: '0.5px solid #e5e7eb', borderRadius: 10,
          padding: '3rem', textAlign: 'center',
          color: '#9ca3af', fontSize: 13,
        }}>
          Loading…
        </div>
      )}

      {ran && !loading && (
        <div style={{ border: '0.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '0.5px solid #e5e7eb' }}>
                {['Employee', 'Leave type', 'Dates', 'Duration', 'Reason', 'Admin note', 'Status', 'Submitted'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '0.6rem 0.75rem',
                    fontSize: 11, fontWeight: 500, color: '#6b7280',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: '#9ca3af' }}>
                    No requests found for this date range and status filter.
                  </td>
                </tr>
              ) : rows.map(r => (
                <tr key={r.id}
                  style={{ borderBottom: '0.5px solid #f3f4f6' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  {/* Employee */}
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{r.user?.full_name ?? '—'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' }}>{r.user?.role}</div>
                  </td>

                  {/* Leave type */}
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                        background: r.leave_types?.color ?? '#9CA3AF', flexShrink: 0,
                      }} />
                      {r.leave_types?.name ?? '—'}
                    </div>
                  </td>

                  {/* Dates */}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {fmtDate(r.start_date)}
                    {r.start_date !== r.end_date && <> → {fmtDate(r.end_date)}</>}
                  </td>

                  {/* Duration */}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {fmtDuration(r)}
                  </td>

                  {/* Reason */}
                  <td style={{ ...td, color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.reason || <span style={{ color: '#d1d5db' }}>—</span>}
                  </td>

                  {/* Admin note */}
                  <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.admin_note
                      ? <span style={{
                          fontSize: 11, padding: '2px 7px', borderRadius: 5,
                          ...(r.status === 'rejected'
                            ? { background: '#FCEBEB', color: '#A32D2D' }
                            : { background: '#E1F5EE', color: '#0F6E56' }),
                        }}>{r.admin_note}</span>
                      : <span style={{ color: '#d1d5db' }}>—</span>}
                  </td>

                  {/* Status */}
                  <td style={td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '2px 8px', borderRadius: 20,
                      fontSize: 11, fontWeight: 500,
                      textTransform: 'capitalize',
                      ...(STATUS_STYLE[r.status] ?? { background: '#f3f4f6', color: '#6b7280' }),
                    }}>{r.status}</span>
                  </td>

                  {/* Submitted */}
                  <td style={{ ...td, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                    {r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length > 0 && (
            <div style={{
              padding: '0.6rem 0.75rem',
              borderTop: '0.5px solid #e5e7eb',
              background: '#fafafa',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {rows.length} record{rows.length === 1 ? '' : 's'}
              </span>
              <Btn variant="primary" size="sm" onClick={handleDownload}>
                ↓ Download CSV
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── UI primitives ────────────────────────────────────────────

const inputStyle = {
  fontSize: 13, padding: '0.4rem 0.65rem',
  border: '0.5px solid #d1d5db', borderRadius: 8,
  fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box', background: '#fff',
}

const td = {
  padding: '0.7rem 0.75rem', verticalAlign: 'middle',
}

const Field = ({ label, children }) => (
  <div>
    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>{label}</label>
    {children}
  </div>
)

const Btn = ({ children, onClick, variant = 'default', size = 'md', disabled }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: size === 'sm' ? 12 : 13,
    padding: size === 'sm' ? '0.3rem 0.65rem' : '0.45rem 0.9rem',
    borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', border: '0.5px solid #d1d5db',
    opacity: disabled ? 0.5 : 1, transition: 'all .15s',
  }
  const variants = {
    default: { background: 'transparent', color: '#111' },
    primary: { background: '#1D9E75', border: '0.5px solid #1D9E75', color: '#fff' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  )
}
