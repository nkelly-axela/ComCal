/**
 * src/components/LeaveAdminPanel.jsx
 * ─────────────────────────────────────────────────────────────
 * Leave Management — Admin Panel
 * Wired up to Supabase against the migration_01 + migration_02
 * + migration_03 + migration_04 schema.
 *
 * VIEWS USED:
 *   - v_leave_balances   → Allowances tab
 *   - v_pending_requests → (future: approval panel)
 *
 * FUNCTIONS USED:
 *   - seed_annual_allowances(year, admin_uuid)
 *   - adjust_allowance(user_id, leave_type_id, year, new_total, performed_by, note)
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Colour swatch ────────────────────────────────────────────
const Swatch = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: 3,
      background: color,
      marginRight: 6,
      flexShrink: 0,
    }}
  />
)

// ─── Progress bar ─────────────────────────────────────────────
const ProgressBar = ({ used, total }) => {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const fill = pct > 80 ? '#E24B4A' : pct > 50 ? '#EF9F27' : '#1D9E75'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 13 }}>{used} days</span>
      <div style={{ width: 80, height: 5, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: fill, borderRadius: 3 }} />
      </div>
    </div>
  )
}

// ─── Toggle switch ────────────────────────────────────────────
const Toggle = ({ checked, onChange }) => (
  <label style={{ position: 'relative', display: 'inline-block', width: 32, height: 18, cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
      style={{ opacity: 0, width: 0, height: 0 }} />
    <span style={{
      position: 'absolute', inset: 0,
      background: checked ? '#1D9E75' : '#d1d5db',
      borderRadius: 9, transition: '.2s',
    }}>
      <span style={{
        position: 'absolute', width: 12, height: 12,
        left: checked ? 17 : 3, top: 3,
        background: '#fff', borderRadius: '50%', transition: '.2s',
      }} />
    </span>
  </label>
)

// ─── Badge ────────────────────────────────────────────────────
const Badge = ({ children, variant = 'gray' }) => {
  const styles = {
    green:  { background: '#E1F5EE', color: '#0F6E56' },
    amber:  { background: '#FAEEDA', color: '#854F0B' },
    gray:   { background: '#F1EFE8', color: '#5F5E5A' },
    blue:   { background: '#E6F1FB', color: '#185FA5' },
    red:    { background: '#FCEBEB', color: '#A32D2D' },
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

// ─── Modal wrapper ────────────────────────────────────────────
const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, border: '0.5px solid #e5e7eb',
        padding: '1.5rem', width: 400, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

// ─── Field ────────────────────────────────────────────────────
const Field = ({ label, children }) => (
  <div style={{ marginBottom: '0.85rem' }}>
    <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</label>
    {children}
  </div>
)

const inputStyle = {
  width: '100%', fontSize: 13, padding: '0.45rem 0.65rem',
  border: '0.5px solid #d1d5db', borderRadius: 8,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

const selectStyle = { ...inputStyle }

// ─── Button ───────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = 'default', size = 'md', disabled }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: size === 'sm' ? 12 : 13,
    padding: size === 'sm' ? '0.3rem 0.65rem' : '0.45rem 0.9rem',
    borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', transition: 'all .15s', border: '0.5px solid #d1d5db',
    opacity: disabled ? 0.5 : 1,
  }
  const variants = {
    default:  { background: 'transparent', color: '#111' },
    primary:  { background: '#1D9E75', border: '0.5px solid #1D9E75', color: '#fff' },
    danger:   { background: 'transparent', border: '0.5px solid #fca5a5', color: '#991b1b' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  )
}

// ─── Table shell ──────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function LeaveAdminPanel() {
  const currentYear = new Date().getFullYear()

  const [tab, setTab] = useState('overview')

  const [leaveTypes, setLeaveTypes] = useState([])
  const [ltLoading, setLtLoading] = useState(false)
  const [ltModal, setLtModal] = useState(false)
  const [ltEditing, setLtEditing] = useState(null)
  const [ltForm, setLtForm] = useState({ name: '', days: '', color: '#4CAF50', approval: true })

  const [entitlements, setEntitlements] = useState([])
  const [entModal, setEntModal] = useState(false)
  const [entForm, setEntForm] = useState({ typeId: '', role: '', days: '' })

  const [allowances, setAllowances] = useState([])
  const [alYear, setAlYear] = useState(currentYear)
  const [alModal, setAlModal] = useState(false)
  const [alEditing, setAlEditing] = useState(null)
  const [alForm, setAlForm] = useState({ userId: '', typeId: '', year: currentYear, total: '', note: '' })
  const [employees, setEmployees] = useState([])

  const [requests, setRequests] = useState([])
  const [reqFilter, setReqFilter] = useState('pending')

  const [seedLoading, setSeedLoading] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const loadRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .select(`
          id, start_date, end_date, days_requested, status, reason, created_at,
          leave_types ( name, color ),
          user:users!leave_requests_user_id_fkey ( full_name, role )
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      setRequests(data ?? [])
    } catch (e) {
      showToast(e.message, 'error')
    }
  }, [])

  const approveRequest = async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('leave_requests')
        .update({ status: 'approved', approver_id: user?.id })
        .eq('id', id)
      if (error) throw error
      showToast('Request approved')
      await loadRequests()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const rejectRequest = async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('leave_requests')
        .update({ status: 'rejected', approver_id: user?.id })
        .eq('id', id)
      if (error) throw error
      showToast('Request rejected')
      await loadRequests()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const loadLeaveTypes = useCallback(async () => {
    setLtLoading(true)
    try {
      const { data, error } = await supabase
        .from('leave_types')
        .select('*')
        .order('name')
      if (error) throw error
      setLeaveTypes(data)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLtLoading(false)
    }
  }, [])

  const loadEntitlements = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('leave_type_entitlements')
        .select('*, leave_types(name, color)')
        .order('leave_type_id')
      if (error) throw error
      setEntitlements(data)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }, [])

  const loadAllowances = useCallback(async (yr) => {
    try {
      const { data, error } = await supabase
        .from('v_leave_balances')
        .select('*')
        .eq('year', yr)
        .order('full_name')
      if (error) throw error
      setAllowances(data)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }, [])

  const loadEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, role')
        .order('full_name')
      if (error) throw error
      setEmployees(data)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }, [])

  useEffect(() => {
    loadLeaveTypes()
    loadEntitlements()
    loadAllowances(alYear)
    loadEmployees()
    loadRequests()
  }, [loadLeaveTypes, loadEntitlements, loadAllowances, loadEmployees, loadRequests, alYear])

  const saveLeaveType = async () => {
    if (!ltForm.name.trim()) return
    try {
      if (ltEditing) {
        const { error } = await supabase.from('leave_types').update({
          name: ltForm.name,
          max_days_per_year: ltForm.days ? +ltForm.days : null,
          color: ltForm.color,
          requires_approval: ltForm.approval,
        }).eq('id', ltEditing)
        if (error) throw error
        showToast('Leave type updated')
      } else {
        const { error } = await supabase.from('leave_types').insert({
          name: ltForm.name,
          max_days_per_year: ltForm.days ? +ltForm.days : null,
          color: ltForm.color,
          requires_approval: ltForm.approval,
        })
        if (error) throw error
        showToast('Leave type added')
      }
      setLtModal(false)
      setLtEditing(null)
      await loadLeaveTypes()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const deleteLeaveType = async (id) => {
    if (!window.confirm('Delete this leave type? This will also remove related entitlements.')) return
    try {
      const { error } = await supabase.from('leave_types').delete().eq('id', id)
      if (error) throw error
      showToast('Leave type deleted')
      await Promise.all([loadLeaveTypes(), loadEntitlements()])
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const saveEntitlement = async () => {
    if (!entForm.typeId || !entForm.days) return
    try {
      const { error } = await supabase.from('leave_type_entitlements').upsert({
        leave_type_id: entForm.typeId,
        role: entForm.role || null,
        default_days: +entForm.days,
      }, { onConflict: 'leave_type_id,role' })
      if (error) throw error
      showToast('Entitlement saved')
      setEntModal(false)
      await loadEntitlements()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const deleteEntitlement = async (id) => {
    try {
      const { error } = await supabase.from('leave_type_entitlements').delete().eq('id', id)
      if (error) throw error
      showToast('Rule removed')
      await loadEntitlements()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const saveAllowance = async () => {
    if (!alForm.userId || !alForm.typeId || !alForm.total) return
    try {
      if (alEditing) {
        const { data: { user } } = await supabase.auth.getUser()
        const { error } = await supabase.rpc('adjust_allowance', {
          p_user_id: alForm.userId,
          p_leave_type_id: alForm.typeId,
          p_year: alForm.year,
          p_new_total: +alForm.total,
          p_performed_by: user?.id,
          p_note: alForm.note || null,
        })
        if (error) throw error
        showToast('Allowance adjusted')
      } else {
        const { error } = await supabase.from('leave_allowances').insert({
          user_id: alForm.userId,
          leave_type_id: alForm.typeId,
          year: alForm.year,
          total_days: +alForm.total,
          used_days: 0,
        })
        if (error) throw error
        showToast('Allowance added')
      }
      setAlModal(false)
      setAlEditing(null)
      await loadAllowances(alYear)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const seedAllowances = async () => {
    setSeedLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.rpc('seed_annual_allowances', {
        p_year: currentYear,
        p_performed_by: user?.id,
      })
      if (error) throw error
      await loadAllowances(alYear)
      const created = Array.isArray(data) ? data.filter(r => !r.skipped).length : 0
      showToast(`Seeded ${created} allowances`)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSeedLoading(false)
    }
  }

  const navItems = [
    { id: 'overview',     label: 'Overview',      dot: '#1D9E75' },
    { id: 'requests',     label: 'Requests',      dot: '#E24B4A' },
    { id: 'leave-types',  label: 'Leave types',   dot: '#378ADD' },
    { id: 'entitlements', label: 'Entitlements',  dot: '#BA7517' },
    { id: 'allowances',   label: 'Allowances',    dot: '#D4537E' },
  ]

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#111', position: 'relative' }}>

      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 100,
          background: toast.type === 'error' ? '#fee2e2' : '#d1fae5',
          color: toast.type === 'error' ? '#991b1b' : '#065f46',
          padding: '0.6rem 1rem', borderRadius: 8, fontSize: 13,
          border: `0.5px solid ${toast.type === 'error' ? '#fca5a5' : '#6ee7b7'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: '200px 1fr',
        minHeight: 600, border: '0.5px solid #e5e7eb', borderRadius: 12, overflow: 'hidden',
        background: '#fff',
      }}>

        <nav style={{ background: '#fafafa', borderRight: '0.5px solid #e5e7eb', padding: '1.25rem 0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', letterSpacing: '.08em', padding: '0 1rem 0.75rem', textTransform: 'uppercase' }}>
            Leave admin
          </div>
          {navItems.map(n => (
            <div key={n.id} onClick={() => setTab(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '0.6rem 1rem', fontSize: 13, cursor: 'pointer',
              color: tab === n.id ? '#111' : '#6b7280',
              background: tab === n.id ? '#fff' : 'transparent',
              borderLeft: `2px solid ${tab === n.id ? '#1D9E75' : 'transparent'}`,
              fontWeight: tab === n.id ? 500 : 400,
              transition: 'all .15s',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: n.dot, flexShrink: 0 }} />
              {n.label}
            </div>
          ))}
          <div style={{ marginTop: 'auto', padding: '1rem', borderTop: '0.5px solid #e5e7eb' }}>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Current year</div>
            <div style={{ fontSize: 20, fontWeight: 500 }}>{currentYear}</div>
          </div>
        </nav>

        <main style={{ padding: '1.5rem', overflowY: 'auto' }}>

          {tab === 'requests' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Leave requests</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Review and approve or reject employee requests</div>
                </div>
                <div style={{ display: 'flex', gap: 4, padding: 3, background: '#f3f4f6', borderRadius: 8 }}>
                  {['pending','approved','rejected','all'].map(f => (
                    <button key={f} onClick={() => setReqFilter(f)} style={{
                      fontSize: 12, padding: '0.3rem 0.7rem', border: 'none', cursor: 'pointer',
                      background: reqFilter === f ? '#fff' : 'transparent',
                      borderRadius: 6, fontFamily: 'inherit',
                      color: reqFilter === f ? '#111' : '#6b7280',
                      fontWeight: reqFilter === f ? 500 : 400,
                      boxShadow: reqFilter === f ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      textTransform: 'capitalize',
                    }}>{f}</button>
                  ))}
                </div>
              </div>

              <Table headers={['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status', 'Actions']} empty="No requests found">
                {requests
                  .filter(r => reqFilter === 'all' || r.status === reqFilter)
                  .map(r => (
                  <TR key={r.id}>
                    <TD>
                      <div style={{ fontWeight: 500 }}>{r.user?.full_name ?? '—'}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' }}>{r.user?.role}</div>
                    </TD>
                    <TD>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Swatch color={r.leave_types?.color} />
                        {r.leave_types?.name}
                      </div>
                    </TD>
                    <TD style={{ whiteSpace: 'nowrap' }}>
                      {new Date(r.start_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      {' → '}
                      {new Date(r.end_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </TD>
                    <TD>{r.days_requested}</TD>
                    <TD style={{ color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.reason || '—'}
                    </TD>
                    <TD>
                      <Badge variant={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>
                        {r.status}
                      </Badge>
                    </TD>
                    <TD>
                      {r.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="sm" variant="primary" onClick={() => approveRequest(r.id)}>Approve</Btn>
                          <Btn size="sm" variant="danger" onClick={() => rejectRequest(r.id)}>Reject</Btn>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </Table>
            </div>
          )}

          {tab === 'overview' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Overview</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Leave system at a glance</div>
                </div>
                <Btn variant="primary" size="sm" onClick={seedAllowances} disabled={seedLoading}>
                  {seedLoading ? 'Seeding…' : `Seed ${currentYear} allowances`}
                </Btn>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: '1.25rem' }}>
                {[
                  { label: 'Leave types', val: leaveTypes.length, sub: 'Active' },
                  { label: 'Entitlement rules', val: entitlements.length, sub: 'Across all types' },
                  { label: 'Allowances seeded', val: allowances.filter(a => a.year === currentYear).length, sub: 'This year' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#f9fafb', borderRadius: 8, padding: '0.9rem 1rem' }}>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 500 }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              <Table headers={['Type', 'Default days', 'Approval', 'Status']} empty="No leave types configured">
                {leaveTypes.map(lt => {
                  const ent = entitlements.find(e => e.leave_type_id === lt.id && !e.role)
                  return (
                    <TR key={lt.id}>
                      <TD><Swatch color={lt.color} />{lt.name}</TD>
                      <TD>{ent ? `${ent.default_days} days` : <Badge variant="amber">No default</Badge>}</TD>
                      <TD><Badge variant={lt.requires_approval ? 'blue' : 'gray'}>{lt.requires_approval ? 'Yes' : 'No'}</Badge></TD>
                      <TD><Badge variant="green">Active</Badge></TD>
                    </TR>
                  )
                })}
              </Table>
            </div>
          )}

          {tab === 'leave-types' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Leave types</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Configure what kinds of leave employees can request</div>
                </div>
                <Btn variant="primary" size="sm" onClick={() => {
                  setLtEditing(null)
                  setLtForm({ name: '', days: '', color: '#4CAF50', approval: true })
                  setLtModal(true)
                }}>+ Add type</Btn>
              </div>

              <Table headers={['Name', 'Colour', 'Max days/yr', 'Requires approval', 'Actions']} empty="No leave types yet">
                {leaveTypes.map(lt => (
                  <TR key={lt.id}>
                    <TD><span style={{ fontWeight: 500 }}>{lt.name}</span></TD>
                    <TD>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Swatch color={lt.color} />
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{lt.color}</span>
                      </div>
                    </TD>
                    <TD>{lt.max_days_per_year ?? '—'}</TD>
                    <TD>
                      <Toggle checked={lt.requires_approval} onChange={async (val) => {
                        setLeaveTypes(prev => prev.map(l => l.id === lt.id ? { ...l, requires_approval: val } : l))
                        const { error } = await supabase
                          .from('leave_types')
                          .update({ requires_approval: val })
                          .eq('id', lt.id)
                        if (error) {
                          showToast(error.message, 'error')
                          setLeaveTypes(prev => prev.map(l => l.id === lt.id ? { ...l, requires_approval: !val } : l))
                        }
                      }} />
                    </TD>
                    <TD>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn size="sm" onClick={() => {
                          setLtEditing(lt.id)
                          setLtForm({ name: lt.name, days: lt.max_days_per_year ?? '', color: lt.color, approval: lt.requires_approval })
                          setLtModal(true)
                        }}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => deleteLeaveType(lt.id)}>Delete</Btn>
                      </div>
                    </TD>
                  </TR>
                ))}
              </Table>
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: '0.75rem' }}>
                Changes here update <code>leave_types</code> and <code>leave_type_entitlements</code> in Supabase.
              </p>
            </div>
          )}

          {tab === 'entitlements' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Entitlements</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Default days granted per leave type, with optional role overrides</div>
                </div>
                <Btn variant="primary" size="sm" onClick={() => {
                  setEntForm({ typeId: leaveTypes[0]?.id ?? '', role: '', days: '' })
                  setEntModal(true)
                }}>+ Add rule</Btn>
              </div>

              <div style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', borderRadius: 8, padding: '0.6rem 0.85rem', marginBottom: '1rem', border: '0.5px solid #e5e7eb' }}>
                Role-specific rules override company-wide defaults. <strong>No role</strong> = applies to everyone.
              </div>

              <Table headers={['Leave type', 'Applies to', 'Days', 'Actions']} empty="No entitlement rules yet">
                {entitlements.map(e => (
                  <TR key={e.id}>
                    <TD>
                      <Swatch color={e.leave_types?.color} />
                      {e.leave_types?.name}
                    </TD>
                    <TD>
                      {e.role
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 12, fontSize: 11, border: '0.5px solid #e5e7eb', background: '#f9fafb', color: '#6b7280' }}>{e.role}</span>
                        : <Badge variant="gray">Everyone</Badge>}
                    </TD>
                    <TD><strong>{e.default_days}</strong> days</TD>
                    <TD>
                      <Btn size="sm" variant="danger" onClick={() => deleteEntitlement(e.id)}>Remove</Btn>
                    </TD>
                  </TR>
                ))}
              </Table>
            </div>
          )}

          {tab === 'allowances' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Allowances</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Per-person leave balance for the selected year</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={alYear} onChange={e => setAlYear(+e.target.value)} style={{ ...selectStyle, width: 'auto', padding: '0.4rem 0.65rem' }}>
                    {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <Btn variant="primary" size="sm" onClick={() => {
                    setAlEditing(null)
                    setAlForm({ userId: employees[0]?.id ?? '', typeId: leaveTypes[0]?.id ?? '', year: alYear, total: '', note: '' })
                    setAlModal(true)
                  }}>+ Add allowance</Btn>
                </div>
              </div>

              <Table headers={['Employee', 'Leave type', 'Total', 'Used', 'Remaining', 'Actions']} empty={`No allowances seeded for ${alYear}. Run seed_annual_allowances() in Supabase.`}>
                {allowances.filter(a => a.year === alYear).map(a => (
                  <TR key={a.id}>
                    <TD>
                      <div style={{ fontWeight: 500 }}>{a.full_name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{a.role}</div>
                    </TD>
                    <TD><Swatch color={a.color} />{a.leave_type}</TD>
                    <TD>{a.total_days} days</TD>
                    <TD><ProgressBar used={a.used_days} total={a.total_days} /></TD>
                    <TD>
                      <strong style={{ color: a.remaining_days < 3 ? '#991b1b' : '#111' }}>
                        {a.remaining_days} days
                      </strong>
                    </TD>
                    <TD>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn size="sm" onClick={() => {
                          setAlEditing(a.id)
                          setAlForm({ userId: a.user_id, typeId: a.leave_type_id, year: a.year, total: a.total_days, note: '' })
                          setAlModal(true)
                        }}>Adjust</Btn>
                        <Btn size="sm" variant="danger" onClick={async () => {
                          const { error } = await supabase.from('leave_allowances').delete().eq('id', a.id)
                          if (error) { showToast(error.message, 'error'); return }
                          showToast('Allowance removed')
                          await loadAllowances(alYear)
                        }}>Remove</Btn>
                      </div>
                    </TD>
                  </TR>
                ))}
              </Table>
            </div>
          )}

        </main>
      </div>

      <Modal open={ltModal} onClose={() => setLtModal(false)} title={ltEditing ? 'Edit leave type' : 'Add leave type'}>
        <Field label="Name">
          <input style={inputStyle} value={ltForm.name} onChange={e => setLtForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Paternity Leave" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Max days / year">
            <input style={inputStyle} type="number" min="0" value={ltForm.days} onChange={e => setLtForm(f => ({ ...f, days: e.target.value }))} placeholder="e.g. 25" />
          </Field>
          <Field label="Colour">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" value={ltForm.color} onChange={e => setLtForm(f => ({ ...f, color: e.target.value }))}
                style={{ width: 32, height: 32, borderRadius: 6, border: '0.5px solid #d1d5db', cursor: 'pointer', padding: 0 }} />
              <span style={{ fontSize: 12, color: '#6b7280' }}>{ltForm.color}</span>
            </div>
          </Field>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
          <label style={{ fontSize: 13 }}>Requires approval</label>
          <Toggle checked={ltForm.approval} onChange={val => setLtForm(f => ({ ...f, approval: val }))} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
          <Btn size="sm" onClick={() => setLtModal(false)}>Cancel</Btn>
          <Btn size="sm" variant="primary" onClick={saveLeaveType}>Save type</Btn>
        </div>
      </Modal>

      <Modal open={entModal} onClose={() => setEntModal(false)} title="Add entitlement rule">
        <Field label="Leave type">
          <select style={selectStyle} value={entForm.typeId} onChange={e => setEntForm(f => ({ ...f, typeId: e.target.value }))}>
            {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
          </select>
        </Field>
        <Field label="Applies to">
          <select style={selectStyle} value={entForm.role} onChange={e => setEntForm(f => ({ ...f, role: e.target.value }))}>
            <option value="">Everyone (company default)</option>
            <option value="employee">Employees only</option>
            <option value="manager">Managers only</option>
            <option value="admin">Admins only</option>
          </select>
        </Field>
        <Field label="Default days">
          <input style={inputStyle} type="number" min="0" step="0.5" value={entForm.days} onChange={e => setEntForm(f => ({ ...f, days: e.target.value }))} placeholder="e.g. 25" />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
          <Btn size="sm" onClick={() => setEntModal(false)}>Cancel</Btn>
          <Btn size="sm" variant="primary" onClick={saveEntitlement}>Save rule</Btn>
        </div>
      </Modal>

      <Modal open={alModal} onClose={() => setAlModal(false)} title={alEditing ? 'Adjust allowance' : 'Add allowance'}>
        <Field label="Employee">
          <select style={selectStyle} value={alForm.userId} onChange={e => setAlForm(f => ({ ...f, userId: e.target.value }))}>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </Field>
        <Field label="Leave type">
          <select style={selectStyle} value={alForm.typeId} onChange={e => setAlForm(f => ({ ...f, typeId: e.target.value }))}>
            {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Year">
            <input style={inputStyle} type="number" min="2020" max="2030" value={alForm.year} onChange={e => setAlForm(f => ({ ...f, year: +e.target.value }))} />
          </Field>
          <Field label="Total days">
            <input style={inputStyle} type="number" min="0" step="0.5" value={alForm.total} onChange={e => setAlForm(f => ({ ...f, total: e.target.value }))} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input style={inputStyle} value={alForm.note} onChange={e => setAlForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. Long service award +3 days" />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
          <Btn size="sm" onClick={() => setAlModal(false)}>Cancel</Btn>
          <Btn size="sm" variant="primary" onClick={saveAllowance}>Save allowance</Btn>
        </div>
      </Modal>

    </div>
  )
}
