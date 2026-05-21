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

import React, { useState, useEffect, useCallback } from 'react'
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
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      borderRadius: 12,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, border: '0.5px solid #e5e7eb',
        padding: '1.5rem', width: 400, maxWidth: '90%',
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
  const [alYear, setAlYear] = useState(currentYear) // updated to holidayYearLabel after load
  const [alModal, setAlModal] = useState(false)
  const [alEditing, setAlEditing] = useState(null)
  const [alForm, setAlForm] = useState({ userId: '', typeId: '', year: currentYear, total: '', note: '' })
  const [employees, setEmployees] = useState([])

  const [requests, setRequests] = useState([])
  const [reqFilter, setReqFilter] = useState('pending')
  const [actionModal, setActionModal] = useState(null)
  const [actionNote, setActionNote] = useState('')

  const [auditLog,     setAuditLog]     = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditPage,    setAuditPage]    = useState(1)
  const [auditTotal,   setAuditTotal]   = useState(0)
  const [auditFilter,  setAuditFilter]  = useState('all')
  const AUDIT_PAGE_SIZE = 50

  const [empList, setEmpList] = useState([])
  const [empModal, setEmpModal] = useState(false)
  const [empEditing, setEmpEditing] = useState(null)
  const [empForm, setEmpForm] = useState({ full_name: '', email: '', role: 'employee', company: '', department: '', manager_id: '' })

  // Add user / invite state
  const [addUserModal,   setAddUserModal]   = useState(false)
  const [addUserBusy,    setAddUserBusy]    = useState(false)
  const [addUserForm,    setAddUserForm]    = useState({ full_name:'', email:'', role:'employee', department:'', company:'', manager_id:'' })
  const [inviteLink,     setInviteLink]     = useState(null) // shown after invite created
  const [pendingInvites, setPendingInvites] = useState([])
  const [invitesLoading, setInvitesLoading] = useState(false)

  const [seedLoading, setSeedLoading] = useState(false)
  const [seedYear,    setSeedYear]    = useState(currentYear + 1) // default to next year so admin seeds ahead
  const [toast, setToast] = useState(null)

  // Holiday year state — from get_holiday_year_dates()
  const [holidayYearLabel, setHolidayYearLabel] = useState(currentYear)
  const [holidayYearStartDate, setHolidayYearStartDate] = useState(null)
  const [holidayYearEndDate,   setHolidayYearEndDate]   = useState(null)

  // Holiday year setting — MM-DD string from company_settings
  const [holidayYearStart, setHolidayYearStart] = useState('01-01')
  const [holidayYearSaving, setHolidayYearSaving] = useState(false)

  const loadHolidayYear = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('get_holiday_year_dates')
      if (data?.[0]) {
        setHolidayYearLabel(data[0].year_label)
        setHolidayYearStartDate(data[0].year_start)
        setHolidayYearEndDate(data[0].year_end)
        setSeedYear(data[0].year_label + 1)
        // Only set alYear once on initial load if it's still the default
        setAlYear(prev => prev === new Date().getFullYear() ? data[0].year_label : prev)
      }
    } catch { /* silently ignore */ }
  }, [])

  // Rollover settings
  const [rolloverEnabled,      setRolloverEnabled]      = useState(true)
  const [rolloverMaxDays,      setRolloverMaxDays]       = useState('5')
  const [rolloverExpiryMonths, setRolloverExpiryMonths] = useState('3')
  const [rolloverSaving,       setRolloverSaving]        = useState(false)
  const [rolloverPreview,      setRolloverPreview]       = useState(null)
  const [rolloverRunning,      setRolloverRunning]       = useState(false)

  // Public holidays
  const [publicHolidays,    setPublicHolidays]    = useState([])
  const [phLoading,         setPhLoading]          = useState(false)
  const [phYear,            setPhYear]             = useState(new Date().getFullYear())
  const [phRegion,          setPhRegion]           = useState('england-and-wales')
  const [phImporting,       setPhImporting]        = useState(false)
  const [phApiHolidays,     setPhApiHolidays]      = useState([]) // fetched from gov.uk, not yet saved

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const loadRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .select(`
          id, start_date, end_date, days_requested, hours_requested,
          status, reason, admin_note, conflict_flag, conflict_detail, created_at,
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

  const loadAuditLog = useCallback(async (page = 1, filter = 'all') => {
    setAuditLoading(true)
    try {
      const from = (page - 1) * AUDIT_PAGE_SIZE
      const to   = from + AUDIT_PAGE_SIZE - 1

      let query = supabase
        .from('leave_audit_log')
        .select(`
          id, action, note, created_at, performed_by_name,
          leave_request_id,
          leave_requests (
            start_date, end_date, days_requested, hours_requested,
            user:users!leave_requests_user_id_fkey ( full_name ),
            leave_types ( name, color )
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (filter !== 'all') query = query.eq('action', filter)

      const { data, error, count } = await query
      if (error) throw error
      setAuditLog(data ?? [])
      setAuditTotal(count ?? 0)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setAuditLoading(false)
    }
  }, [AUDIT_PAGE_SIZE])

  const loadEmpList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, role, company, department, manager_id')
        .order('full_name')
      if (error) throw error
      setEmpList(data ?? [])
    } catch (e) {
      showToast(e.message, 'error')
    }
  }, [])

  const openAction = (id, action) => {
    setActionNote('')
    setActionModal({ id, action })
  }

  const confirmAction = async () => {
    if (!actionModal) return
    const { id, action } = actionModal
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Map action to new status
      const newStatus =
        action === 'approve'              ? 'approved'  :
        action === 'reject'               ? 'rejected'  :
        action === 'approve_cancellation' ? 'cancelled' :
        action === 'reject_cancellation'  ? 'approved'  : null

      if (!newStatus) throw new Error('Unknown action')

      const { error } = await supabase
        .from('leave_requests')
        .update({
          status:      newStatus,
          approver_id: user?.id,
          admin_note:  actionNote.trim() || null,
        })
        .eq('id', id)
      if (error) throw error

      // Write audit log entry
      const performer = empList.find(e => e.id === user?.id)
      await supabase.from('leave_audit_log').insert({
        leave_request_id:  id,
        action:            action,
        performed_by:      user?.id,
        performed_by_name: performer?.full_name ?? user?.email ?? 'Unknown',
        note:              actionNote.trim() || null,
      })

      const toastMsg = {
        approve:              'Request approved',
        reject:               'Request rejected',
        approve_cancellation: 'Cancellation approved — days restored',
        reject_cancellation:  'Cancellation rejected — leave reinstated',
      }[action]

      showToast(toastMsg)
      setActionModal(null)
      setActionNote('')
      await Promise.all([loadRequests(), loadAuditLog()])
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const exportAuditCSV = async () => {
    try {
      // Fetch all records for export (no pagination)
      let query = supabase
        .from('leave_audit_log')
        .select(`
          id, action, note, created_at, performed_by_name,
          leave_requests (
            start_date, end_date, days_requested, hours_requested,
            user:users!leave_requests_user_id_fkey ( full_name ),
            leave_types ( name )
          )
        `)
        .order('created_at', { ascending: false })

      if (auditFilter !== 'all') query = query.eq('action', auditFilter)

      const { data, error } = await query
      if (error) throw error

      const rows = (data ?? []).map(a => ({
        'Date':        new Date(a.created_at).toLocaleDateString('en-GB'),
        'Time':        new Date(a.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }),
        'Action':      a.action ?? '',
        'Employee':    a.leave_requests?.user?.full_name ?? '',
        'Leave type':  a.leave_requests?.leave_types?.name ?? '',
        'Start date':  a.leave_requests?.start_date ?? '',
        'End date':    a.leave_requests?.end_date ?? '',
        'Duration':    a.leave_requests?.hours_requested
                         ? `${a.leave_requests.hours_requested}h`
                         : a.leave_requests?.days_requested
                         ? `${a.leave_requests.days_requested} days`
                         : '',
        'Actioned by': a.performed_by_name ?? '',
        'Note':        a.note ?? '',
      }))

      const headers = Object.keys(rows[0] ?? {})
      const csv = [
        headers.join(','),
        ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(`Exported ${rows.length} audit entries`)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const saveEmployee = async () => {
    if (!empForm.full_name.trim()) { showToast('Name is required', 'error'); return }
    try {
      const payload = {
        full_name: empForm.full_name.trim(),
        role: empForm.role,
        company: empForm.company.trim() || null,
        department: empForm.department.trim() || null,
        manager_id: empForm.manager_id || null,
      }
      const { error } = await supabase
        .from('users')
        .update(payload)
        .eq('id', empEditing)
      if (error) throw error
      showToast('Employee updated')
      setEmpModal(false)
      setEmpEditing(null)
      await Promise.all([loadEmpList(), loadEmployees()])
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const loadPendingInvites = useCallback(async () => {
    setInvitesLoading(true)
    try {
      const { data, error } = await supabase
        .from('invite_tokens')
        .select('id, email, full_name, role, department, company, token, expires_at, accepted_at, created_at')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      setPendingInvites(data ?? [])
    } catch {
      setPendingInvites([])
    } finally {
      setInvitesLoading(false)
    }
  }, [])

  const createUser = async () => {
    const email = addUserForm.email.trim().toLowerCase()
    const name  = addUserForm.full_name.trim()
    if (!name)  { showToast('Full name is required', 'error'); return }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Valid email is required', 'error'); return
    }
    setAddUserBusy(true)
    setInviteLink(null)
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()

      // Step 1: Write the invite token row so the auth trigger
      // can pick up the role/dept when the user signs in
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const { error: tokenErr } = await supabase
        .from('invite_tokens')
        .upsert({
          email,
          full_name:   name,
          role:        addUserForm.role,
          department:  addUserForm.department.trim() || null,
          company:     addUserForm.company.trim()    || null,
          manager_id:  addUserForm.manager_id        || null,
          invited_by:  currentUser?.id,
          expires_at:  expiresAt,
          accepted_at: null,
        }, { onConflict: 'email' })
      if (tokenErr) throw tokenErr

      // Step 2: Send a magic-link sign-in email via Supabase OTP
      // This works even when public sign-ups are disabled —
      // the user clicks the link and is signed straight in.
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: true, // creates the auth user if they don't exist
          data: { full_name: name, role: addUserForm.role },
        },
      })
      if (otpErr) throw otpErr

      setInviteLink({ email, name, emailSent: true })
      showToast(`Invite email sent to ${email}`)
      await loadPendingInvites()
      await loadEmpList()

    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setAddUserBusy(false)
    }
  }

  const revokeInvite = async (id) => {
    if (!window.confirm('Revoke this invite?')) return
    const { error } = await supabase.from('invite_tokens').delete().eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Invite revoked')
    await loadPendingInvites()
  }

  const copyInviteLink = (link) => {
    navigator.clipboard.writeText(link).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Could not copy — please copy manually', 'error')
    )
  }

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('company_settings')
        .select('key, value')
      if (data) {
        const hys = data.find(s => s.key === 'holiday_year_start')
        if (hys) setHolidayYearStart(hys.value)
        const re  = data.find(s => s.key === 'rollover_enabled')
        if (re)  setRolloverEnabled(re.value === 'true')
        const rm  = data.find(s => s.key === 'rollover_max_days')
        if (rm)  setRolloverMaxDays(rm.value)
        const rx  = data.find(s => s.key === 'rollover_expiry_months')
        if (rx)  setRolloverExpiryMonths(rx.value)
      }
    } catch (e) {
      // Settings table may not exist yet — silently ignore
    }
  }, [])

  const saveSetting = async (key, value) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('company_settings')
      .upsert({ key, value: String(value), updated_by: user?.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' })
    if (error) throw error
  }

  const saveRolloverSettings = async () => {
    setRolloverSaving(true)
    try {
      await Promise.all([
        saveSetting('rollover_enabled',       String(rolloverEnabled)),
        saveSetting('rollover_max_days',      rolloverMaxDays),
        saveSetting('rollover_expiry_months', rolloverExpiryMonths),
      ])
      showToast('Rollover settings saved')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setRolloverSaving(false)
    }
  }

  const previewRollover = async () => {
    setRolloverRunning(true)
    setRolloverPreview(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.rpc('process_year_end_rollover', {
        p_from_year:    holidayYearLabel,
        p_performed_by: user?.id,
      })
      if (error) throw error
      setRolloverPreview(data ?? [])
      showToast(`Rollover processed — ${(data??[]).filter(r=>!r.skipped).length} rows created`)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setRolloverRunning(false)
    }
  }

  const loadPublicHolidays = useCallback(async () => {
    setPhLoading(true)
    try {
      const { data, error } = await supabase
        .from('public_holidays')
        .select('*')
        .order('date', { ascending: true })
      if (error) throw error
      setPublicHolidays(data ?? [])
    } catch (e) {
      // Table may not exist yet
      setPublicHolidays([])
    } finally {
      setPhLoading(false)
    }
  }, [])

  // Fetch from gov.uk API — free, no key needed
  const fetchFromGovUK = async () => {
    setPhImporting(true)
    setPhApiHolidays([])
    try {
      const res  = await fetch('https://www.gov.uk/bank-holidays.json')
      const data = await res.json()
      const regionKey = phRegion === 'england-and-wales' ? 'england-and-wales'
        : phRegion === 'scotland' ? 'scotland' : 'northern-ireland'
      const events = data[regionKey]?.events ?? []
      const filtered = events
        .filter(e => new Date(e.date).getFullYear() === phYear)
        .map(e => ({ date: e.date, name: e.title, notes: e.notes ?? '', bunting: e.bunting ?? false }))
      setPhApiHolidays(filtered)
      showToast(`Found ${filtered.length} holidays for ${phYear}`)
    } catch (e) {
      showToast('Failed to fetch from gov.uk: ' + e.message, 'error')
    } finally {
      setPhImporting(false)
    }
  }

  const importHolidays = async () => {
    if (!phApiHolidays.length) return
    setPhImporting(true)
    try {
      const rows = phApiHolidays.map(h => ({
        date:    h.date,
        name:    h.name,
        region:  phRegion,
        notes:   h.notes || null,
        bunting: h.bunting,
      }))
      const { error } = await supabase
        .from('public_holidays')
        .upsert(rows, { onConflict: 'date,region' })
      if (error) throw error
      showToast(`Imported ${rows.length} public holidays`)
      setPhApiHolidays([])
      await loadPublicHolidays()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setPhImporting(false)
    }
  }

  const deleteHoliday = async (id) => {
    const { error } = await supabase.from('public_holidays').delete().eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Holiday removed')
    setPublicHolidays(prev => prev.filter(h => h.id !== id))
  }

  const saveHolidayYearStart = async (value) => {
    setHolidayYearSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('company_settings')
        .upsert({ key: 'holiday_year_start', value, updated_by: user?.id, updated_at: new Date().toISOString() },
          { onConflict: 'key' })
      if (error) throw error
      setHolidayYearStart(value)
      showToast('Holiday year start saved')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setHolidayYearSaving(false)
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
    loadSettings()
    loadHolidayYear()
    loadLeaveTypes()
    loadEntitlements()
    loadAllowances(alYear)
    loadEmployees()
    loadRequests()
    loadAuditLog()
    loadEmpList()
    loadPublicHolidays()
    loadPendingInvites()
  }, [loadSettings, loadHolidayYear, loadLeaveTypes, loadEntitlements, loadAllowances, loadEmployees, loadRequests, loadAuditLog, loadEmpList, loadPublicHolidays, loadPendingInvites])

  // Reload allowances whenever the selected year changes
  useEffect(() => {
    loadAllowances(alYear)
  }, [alYear, loadAllowances])

  // Reload audit log when page or filter changes
  useEffect(() => {
    loadAuditLog(auditPage, auditFilter)
  }, [auditPage, auditFilter, loadAuditLog])

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
        p_year:         seedYear,
        p_performed_by: user?.id,
      })
      if (error) throw error
      await loadAllowances(alYear)
      const created = Array.isArray(data) ? data.filter(r => !r.skipped).length : 0
      showToast(`Seeded ${created} allowances for holiday year ${seedYear}`)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSeedLoading(false)
    }
  }

  const navItems = [
    { id: 'overview',     label: 'Overview',      dot: '#1D9E75' },
    { id: 'requests',     label: 'Requests',      dot: '#E24B4A' },
    { id: 'employees',    label: 'Employees',     dot: '#6366F1' },
    { id: 'leave-types',  label: 'Leave types',   dot: '#378ADD' },
    { id: 'entitlements', label: 'Entitlements',  dot: '#BA7517' },
    { id: 'allowances',   label: 'Allowances',    dot: '#D4537E' },
    { id: 'audit',            label: 'Audit log',       dot: '#6b7280' },
    { id: 'public-holidays',  label: 'Public holidays', dot: '#0EA5E9' },
    { id: 'rollover',         label: 'Rollover rules',  dot: '#8B5CF6' },
    { id: 'ai-review',        label: 'AI review',       dot: '#7F77DD' },
  ]

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#111', position: 'relative' }}>

      {toast && (
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 100,
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
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Holiday year</div>
            <div style={{ fontSize: 20, fontWeight: 500 }}>{holidayYearLabel}</div>
            {holidayYearStartDate && holidayYearEndDate && (
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {new Date(holidayYearStartDate).toLocaleDateString('en-GB', { day:'numeric', month:'short' })} – {new Date(holidayYearEndDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
              </div>
            )}
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

              <Table headers={['Employee', 'Type', 'Dates', 'Duration', 'Reason', 'Admin note', 'Status', 'Actions']} empty="No requests found">
                {requests
                  .filter(r => reqFilter === 'all' || r.status === reqFilter)
                  .map(r => (
                  <TR key={r.id}>
                    <TD>
                      <div style={{ fontWeight: 500 }}>{r.user?.full_name ?? '—'}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' }}>{r.user?.role}</div>
                    </TD>
                    <TD>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Swatch color={r.leave_types?.color} />
                        {r.leave_types?.name}
                        {r.conflict_flag && (
                          <span title={r.conflict_detail ?? 'Department conflict detected'} style={{ fontSize: 10, background: '#FAEEDA', color: '#854F0B', padding: '1px 6px', borderRadius: 8, cursor: 'help' }}>⚠ conflict</span>
                        )}
                      </div>
                    </TD>
                    <TD style={{ whiteSpace: 'nowrap' }}>
                      {new Date(r.start_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      {r.start_date !== r.end_date && <> → {new Date(r.end_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                    </TD>
                    <TD style={{ whiteSpace: 'nowrap' }}>
                      {r.hours_requested ? `${r.hours_requested}h` : `${r.days_requested} day${r.days_requested === 1 ? '' : 's'}`}
                    </TD>
                    <TD style={{ color: '#6b7280', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.reason || '—'}
                    </TD>
                    <TD style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.admin_note
                        ? <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, ...(r.status === 'rejected' ? { background: '#FCEBEB', color: '#A32D2D' } : { background: '#E1F5EE', color: '#0F6E56' }) }}>{r.admin_note}</span>
                        : <span style={{ color: '#d1d5db' }}>—</span>}
                    </TD>
                    <TD>
                      <Badge variant={
                        r.status === 'approved'             ? 'green' :
                        r.status === 'rejected'             ? 'red'   :
                        r.status === 'cancelled'            ? 'gray'  :
                        r.status === 'cancellation_pending' ? 'amber' : 'amber'
                      }>
                        {r.status === 'cancellation_pending' ? 'Cancellation requested' : r.status}
                      </Badge>
                    </TD>
                    <TD>
                      {r.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="sm" variant="primary" onClick={() => openAction(r.id, 'approve')}>Approve</Btn>
                          <Btn size="sm" variant="danger"  onClick={() => openAction(r.id, 'reject')}>Reject</Btn>
                        </div>
                      )}
                      {r.status === 'cancellation_pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="sm" variant="primary" onClick={() => openAction(r.id, 'approve_cancellation')}>Approve cancellation</Btn>
                          <Btn size="sm" variant="danger"  onClick={() => openAction(r.id, 'reject_cancellation')}>Reject cancellation</Btn>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </Table>
            </div>
          )}

          {tab === 'employees' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Employees</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Manage employee details, roles, departments and managers</div>
                </div>
                <Btn variant="primary" size="sm" onClick={() => {
                  setAddUserForm({ full_name:'', email:'', role:'employee', department:'', company:'', manager_id:'' })
                  setInviteLink(null)
                  setAddUserModal(true)
                }}>+ Add user</Btn>
              </div>

              {/* Active employees */}
              <Table headers={['Name', 'Email', 'Role', 'Department', 'Manager', 'Actions']} empty="No employees found">
                {empList.map(e => {
                  const mgr = empList.find(m => m.id === e.manager_id)
                  return (
                    <TR key={e.id}>
                      <TD>
                        <div style={{ fontWeight: 500 }}>{e.full_name}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>{e.company || ''}</div>
                      </TD>
                      <TD style={{ color: '#6b7280', fontSize: 12 }}>{e.email || '—'}</TD>
                      <TD><Badge variant={e.role === 'admin' ? 'blue' : e.role === 'manager' ? 'green' : 'gray'} style={{ textTransform: 'capitalize' }}>{e.role}</Badge></TD>
                      <TD style={{ color: '#6b7280' }}>{e.department || '—'}</TD>
                      <TD style={{ color: '#6b7280' }}>{mgr?.full_name || '—'}</TD>
                      <TD>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn size="sm" onClick={() => {
                            setEmpEditing(e.id)
                            setEmpForm({
                              full_name:   e.full_name  ?? '',
                              role:        e.role       ?? 'employee',
                              company:     e.company    ?? '',
                              department:  e.department ?? '',
                              manager_id:  e.manager_id ?? '',
                            })
                            setEmpModal(true)
                          }}>Edit</Btn>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </Table>

              {/* Pending invites */}
              {(invitesLoading || pendingInvites.length > 0) && (
                <div style={{ marginTop: '1.5rem' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    Pending invites
                    <span style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>
                      {pendingInvites.length}
                    </span>
                  </div>
                  <Table headers={['Name', 'Email', 'Role', 'Department', 'Expires', 'Actions']} empty="No pending invites">
                    {pendingInvites.map(inv => (
                      <TR key={inv.id}>
                        <TD style={{ fontWeight: 500 }}>{inv.full_name}</TD>
                        <TD style={{ color: '#6b7280', fontSize: 12 }}>{inv.email}</TD>
                        <TD><Badge variant={inv.role === 'admin' ? 'blue' : inv.role === 'manager' ? 'green' : 'gray'}>{inv.role}</Badge></TD>
                        <TD style={{ color: '#6b7280' }}>{inv.department || '—'}</TD>
                        <TD style={{ fontSize: 12, color: '#9ca3af' }}>
                          {new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </TD>
                        <TD>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Btn size="sm" onClick={() => {
                              const link = `${window.location.origin}/invite?token=${inv.token}`
                              copyInviteLink(link)
                            }}>Copy link</Btn>
                            <Btn size="sm" variant="danger" onClick={() => revokeInvite(inv.id)}>Revoke</Btn>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </Table>
                </div>
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Audit log</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                    Full history of who approved or rejected each leave request
                    {auditTotal > 0 && <span style={{ marginLeft:8, color:'#9ca3af' }}>({auditTotal} entries)</span>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <select
                    value={auditFilter}
                    onChange={e => { setAuditFilter(e.target.value); setAuditPage(1) }}
                    style={{ fontSize:12, padding:'0.4rem 0.65rem', border:'0.5px solid #e5e7eb', borderRadius:8, fontFamily:'inherit' }}
                  >
                    <option value="all">All actions</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="seeded">Seeded</option>
                    <option value="pro_rata_seeded">Pro-rata seeded</option>
                    <option value="adjusted">Adjusted</option>
                    <option value="rollover">Rollover</option>
                    <option value="expired">Expired</option>
                  </select>
                  <Btn size="sm" onClick={exportAuditCSV}>⬇ Export CSV</Btn>
                </div>
              </div>

              {auditLoading ? (
                <div style={{ color: '#9ca3af', fontSize: 13, padding: '2rem', textAlign: 'center' }}>Loading…</div>
              ) : (
                <>
                  <Table headers={['Date & time', 'Action', 'Employee', 'Leave', 'Duration', 'Actioned by', 'Note']} empty="No audit entries yet">
                    {auditLog.map(a => {
                      const req = a.leave_requests
                      return (
                        <TR key={a.id}>
                          <TD style={{ whiteSpace: 'nowrap', color: '#6b7280', fontSize: 12 }}>
                            {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            <div style={{ fontSize: 11 }}>{new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                          </TD>
                          <TD>
                            <Badge variant={
                              a.action === 'approved'   ? 'green' :
                              a.action === 'rejected'   ? 'red'   :
                              a.action === 'adjusted'   ? 'blue'  :
                              a.action === 'rollover'   ? 'blue'  : 'gray'
                            }>
                              {a.action}
                            </Badge>
                          </TD>
                          <TD style={{ fontWeight: 500 }}>{req?.user?.full_name ?? '—'}</TD>
                          <TD>
                            {req?.leave_types && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Swatch color={req.leave_types.color} />
                                {req.leave_types.name}
                              </div>
                            )}
                          </TD>
                          <TD style={{ whiteSpace: 'nowrap' }}>
                            {req ? (
                              req.hours_requested
                                ? `${req.hours_requested}h`
                                : `${req.days_requested} day${req.days_requested === 1 ? '' : 's'}`
                            ) : '—'}
                          </TD>
                          <TD style={{ fontWeight: 500, color: '#374151' }}>{a.performed_by_name ?? '—'}</TD>
                          <TD style={{ color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.note}>
                            {a.note || <span style={{ color: '#d1d5db' }}>—</span>}
                          </TD>
                        </TR>
                      )
                    })}
                  </Table>

                  {/* Pagination */}
                  {auditTotal > AUDIT_PAGE_SIZE && (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'1rem', fontSize:13 }}>
                      <div style={{ color:'#6b7280' }}>
                        Showing {((auditPage-1)*AUDIT_PAGE_SIZE)+1}–{Math.min(auditPage*AUDIT_PAGE_SIZE, auditTotal)} of {auditTotal}
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <Btn size="sm" disabled={auditPage === 1} onClick={() => setAuditPage(p => p-1)}>‹ Previous</Btn>
                        {Array.from({ length: Math.ceil(auditTotal/AUDIT_PAGE_SIZE) }, (_,i) => i+1)
                          .filter(p => p === 1 || p === Math.ceil(auditTotal/AUDIT_PAGE_SIZE) || Math.abs(p-auditPage) <= 1)
                          .reduce((acc, p, i, arr) => {
                            if (i > 0 && p - arr[i-1] > 1) acc.push('...')
                            acc.push(p)
                            return acc
                          }, [])
                          .map((p, i) => p === '...'
                            ? <span key={i} style={{ padding:'0 4px', color:'#9ca3af' }}>…</span>
                            : <Btn key={p} size="sm" onClick={() => setAuditPage(p)}
                                style={{ background: p===auditPage?'#1D9E75':'transparent', color: p===auditPage?'#fff':'inherit', borderColor: p===auditPage?'#1D9E75':'#e5e7eb' }}>
                                {p}
                              </Btn>
                          )
                        }
                        <Btn size="sm" disabled={auditPage >= Math.ceil(auditTotal/AUDIT_PAGE_SIZE)} onClick={() => setAuditPage(p => p+1)}>Next ›</Btn>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'public-holidays' && (
            <div>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'1.25rem' }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:500 }}>Public holidays</div>
                  <div style={{ fontSize:13, color:'#6b7280', marginTop:2 }}>
                    Import UK bank holidays from gov.uk. These are excluded from leave day calculations.
                  </div>
                </div>
              </div>

              {/* Import controls */}
              <div style={{ border:'0.5px solid #e5e7eb', borderRadius:10, padding:'1.25rem', background:'#fafafa', marginBottom:'1.25rem' }}>
                <div style={{ fontSize:13, fontWeight:500, marginBottom:'0.75rem' }}>Import from gov.uk</div>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', marginBottom:'0.75rem' }}>
                  <div>
                    <label style={{ display:'block', fontSize:11, color:'#6b7280', marginBottom:4 }}>Year</label>
                    <select value={phYear} onChange={e => setPhYear(+e.target.value)} style={{ ...selectStyle, width:100 }}>
                      {[currentYear-1, currentYear, currentYear+1, currentYear+2].map(y =>
                        <option key={y} value={y}>{y}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ display:'block', fontSize:11, color:'#6b7280', marginBottom:4 }}>Region</label>
                    <select value={phRegion} onChange={e => setPhRegion(e.target.value)} style={{ ...selectStyle, width:200 }}>
                      <option value="england-and-wales">England &amp; Wales</option>
                      <option value="scotland">Scotland</option>
                      <option value="northern-ireland">Northern Ireland</option>
                    </select>
                  </div>
                  <Btn variant="primary" size="sm" onClick={fetchFromGovUK} disabled={phImporting}>
                    {phImporting && !phApiHolidays.length ? 'Fetching…' : 'Fetch from gov.uk'}
                  </Btn>
                </div>

                {/* Preview fetched holidays before saving */}
                {phApiHolidays.length > 0 && (
                  <div>
                    <div style={{ fontSize:12, color:'#6b7280', marginBottom:'0.5rem' }}>
                      {phApiHolidays.length} holidays found — review then import:
                    </div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:'0.75rem' }}>
                      {phApiHolidays.map(h => (
                        <span key={h.date} style={{ fontSize:11, padding:'3px 10px', borderRadius:12, background:'#E6F1FB', color:'#185FA5', border:'0.5px solid #bfdbfe' }}>
                          {new Date(h.date + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' })} — {h.name}
                        </span>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <Btn variant="primary" size="sm" onClick={importHolidays} disabled={phImporting}>
                        {phImporting ? 'Importing…' : `Import ${phApiHolidays.length} holidays`}
                      </Btn>
                      <Btn size="sm" onClick={() => setPhApiHolidays([])}>Discard</Btn>
                    </div>
                  </div>
                )}
              </div>

              {/* Saved holidays */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                <div style={{ fontSize:13, fontWeight:500 }}>
                  Saved holidays ({publicHolidays.filter(h => new Date(h.date).getFullYear() === phYear && h.region === phRegion).length} for {phYear})
                </div>
              </div>
              {phLoading ? (
                <div style={{ color:'#9ca3af', fontSize:13, padding:'1.5rem', textAlign:'center' }}>Loading…</div>
              ) : (
                <Table headers={['Date','Name','Region','Notes','Actions']} empty={`No public holidays saved for ${phYear}. Use the import tool above.`}>
                  {publicHolidays
                    .filter(h => new Date(h.date + 'T00:00:00').getFullYear() === phYear && h.region === phRegion)
                    .map(h => (
                    <TR key={h.id}>
                      <TD style={{ whiteSpace:'nowrap', fontWeight:500 }}>
                        {new Date(h.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}
                      </TD>
                      <TD>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          {h.bunting && <span title="Bunting day" style={{ fontSize:14 }}>🎉</span>}
                          {h.name}
                        </div>
                      </TD>
                      <TD>
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:12, background:'#f3f4f6', color:'#6b7280' }}>
                          {h.region === 'england-and-wales' ? 'England & Wales' : h.region === 'scotland' ? 'Scotland' : 'N. Ireland'}
                        </span>
                      </TD>
                      <TD style={{ color:'#9ca3af', fontSize:12 }}>{h.notes || '—'}</TD>
                      <TD>
                        <Btn size="sm" variant="danger" onClick={() => deleteHoliday(h.id)}>Remove</Btn>
                      </TD>
                    </TR>
                  ))}
                </Table>
              )}
            </div>
          )}

          {tab === 'rollover' && (
            <div>
              <div style={{ marginBottom:'1.25rem' }}>
                <div style={{ fontSize:15, fontWeight:500 }}>Rollover rules</div>
                <div style={{ fontSize:13, color:'#6b7280', marginTop:2 }}>
                  Configure how unused annual leave carries over into the new holiday year.
                </div>
              </div>

              {/* Settings card */}
              <div style={{ border:'0.5px solid #e5e7eb', borderRadius:10, padding:'1.25rem', background:'#fafafa', marginBottom:'1.25rem' }}>
                <div style={{ fontSize:13, fontWeight:500, marginBottom:'1rem' }}>Rollover policy</div>

                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1rem', padding:'0.75rem', background:'#fff', borderRadius:8, border:'0.5px solid #e5e7eb' }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500 }}>Enable rollover</div>
                    <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>Allow unused leave to carry over to the next holiday year</div>
                  </div>
                  <Toggle checked={rolloverEnabled} onChange={setRolloverEnabled} />
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:'1rem', opacity: rolloverEnabled ? 1 : 0.4, pointerEvents: rolloverEnabled ? 'auto' : 'none' }}>
                  <div style={{ background:'#fff', borderRadius:8, border:'0.5px solid #e5e7eb', padding:'1rem' }}>
                    <label style={{ display:'block', fontSize:12, color:'#6b7280', marginBottom:4 }}>Maximum rollover days</label>
                    <input
                      type="number" min="0" max="30" step="0.5"
                      value={rolloverMaxDays}
                      onChange={e => setRolloverMaxDays(e.target.value)}
                      style={{ ...inputStyle, fontSize:15, fontWeight:500, width:80 }}
                    />
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>
                      Max days any employee can carry over. UK statutory guidance is typically 5 days.
                    </div>
                  </div>

                  <div style={{ background:'#fff', borderRadius:8, border:'0.5px solid #e5e7eb', padding:'1rem' }}>
                    <label style={{ display:'block', fontSize:12, color:'#6b7280', marginBottom:4 }}>Expiry (months after new year)</label>
                    <input
                      type="number" min="1" max="12"
                      value={rolloverExpiryMonths}
                      onChange={e => setRolloverExpiryMonths(e.target.value)}
                      style={{ ...inputStyle, fontSize:15, fontWeight:500, width:80 }}
                    />
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>
                      Rolled-over days expire this many months into the new year. e.g. 3 = expires 31 March.
                    </div>
                  </div>
                </div>

                {rolloverEnabled && (
                  <div style={{ fontSize:12, color:'#065f46', background:'#d1fae5', borderRadius:8, padding:'0.6rem 0.85rem', marginBottom:'1rem', border:'0.5px solid #6ee7b7' }}>
                    Current policy: up to <strong>{rolloverMaxDays} days</strong> can be carried over,
                    expiring <strong>{rolloverExpiryMonths} month{+rolloverExpiryMonths!==1?'s':''}</strong> after the new holiday year starts.
                  </div>
                )}

                <div style={{ display:'flex', gap:8 }}>
                  <Btn variant="primary" size="sm" onClick={saveRolloverSettings} disabled={rolloverSaving}>
                    {rolloverSaving ? 'Saving…' : 'Save rollover policy'}
                  </Btn>
                </div>
              </div>

              {/* Run rollover */}
              <div style={{ border:'0.5px solid #e5e7eb', borderRadius:10, padding:'1.25rem', marginBottom:'1.25rem' }}>
                <div style={{ fontSize:13, fontWeight:500, marginBottom:4 }}>Run year-end rollover</div>
                <div style={{ fontSize:12, color:'#6b7280', marginBottom:'1rem' }}>
                  Processes the current holiday year rollover for all employees based on your
                  holiday year start date ({holidayYearStart || '01-01'}).
                  Creates new allowance rows for carried-over days, capped at your policy above.
                  Safe to re-run — existing rollover rows are skipped.
                </div>
                <div style={{ fontSize:12, color:'#854F0B', background:'#FAEEDA', borderRadius:8, padding:'0.6rem 0.85rem', marginBottom:'1rem', border:'0.5px solid #fcd34d' }}>
                  ⚠ Run this on or after the last day of your holiday year, before seeding the new year's allowances.
                  Rolled-over days will expire {rolloverExpiryMonths} month{+rolloverExpiryMonths!==1?'s':''} after the new holiday year starts.
                </div>
                <Btn variant="primary" size="sm" onClick={previewRollover} disabled={rolloverRunning || !rolloverEnabled}>
                  {rolloverRunning ? 'Processing…' : `Process year-end rollover`}
                </Btn>
              </div>

              {/* Rollover preview results */}
              {rolloverPreview && (
                <div>
                  <div style={{ fontSize:13, fontWeight:500, marginBottom:'0.75rem' }}>
                    Rollover results — {rolloverPreview.filter(r=>!r.skipped).length} rows created, {rolloverPreview.filter(r=>r.skipped).length} skipped
                  </div>
                  <Table headers={['Employee','Leave type','Unused','Rolled over','Expiry','Status']} empty="No results">
                    {rolloverPreview.map((r, i) => (
                      <TR key={i}>
                        <TD style={{ fontWeight:500 }}>{r.user_name}</TD>
                        <TD>{r.leave_type_name}</TD>
                        <TD>{r.unused_days}d</TD>
                        <TD><strong style={{ color: r.skipped ? '#9ca3af' : '#0F6E56' }}>{r.rolled_days}d</strong></TD>
                        <TD style={{ fontSize:12, color:'#6b7280' }}>
                          {r.expiry_date ? new Date(r.expiry_date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'}
                        </TD>
                        <TD>
                          {r.skipped
                            ? <Badge variant="gray">{r.skip_reason}</Badge>
                            : <Badge variant="green">Created</Badge>}
                        </TD>
                      </TR>
                    ))}
                  </Table>
                </div>
              )}
            </div>
          )}

          {tab === 'ai-review' && (
            <AIReviewTab requests={requests} employees={employees} />
          )}

          {tab === 'overview' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Overview</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Leave system at a glance</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <select
                    value={seedYear}
                    onChange={e => setSeedYear(+e.target.value)}
                    style={{ fontSize: 13, padding: '0.4rem 0.65rem', border: '0.5px solid #e5e7eb', borderRadius: 8, fontFamily: 'inherit' }}
                  >
                    {[holidayYearLabel - 1, holidayYearLabel, holidayYearLabel + 1, holidayYearLabel + 2].map(y => (
                      <option key={y} value={y}>Holiday year {y}</option>
                    ))}
                  </select>
                  <Btn variant="primary" size="sm" onClick={seedAllowances} disabled={seedLoading}>
                    {seedLoading ? 'Seeding…' : `Seed ${seedYear} allowances`}
                  </Btn>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: '1.25rem' }}>
                {[
                  { label: 'Leave types',       val: leaveTypes.length,                                            sub: 'Active' },
                  { label: 'Entitlement rules',  val: entitlements.length,                                          sub: 'Across all types' },
                  { label: 'Allowances seeded',  val: allowances.filter(a => a.year === holidayYearLabel).length,   sub: `Holiday year ${holidayYearLabel}` },
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

              {/* ── Holiday year settings ── */}
              <div style={{
                marginTop: '1.5rem',
                border: '0.5px solid #e5e7eb', borderRadius: 10,
                padding: '1.25rem', background: '#fafafa',
              }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Holiday year settings</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: '1rem' }}>
                  Set when the holiday year starts. This affects how allowances and balances are calculated.
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Start month</label>
                    <select
                      value={holidayYearStart.split('-')[0]}
                      onChange={e => {
                        const month = e.target.value
                        const currentDay = parseInt(holidayYearStart.split('-')[1] ?? '1')
                        const maxDays = new Date(2000, parseInt(month), 0).getDate()
                        const day = String(Math.min(currentDay, maxDays)).padStart(2, '0')
                        saveHolidayYearStart(`${month}-${day}`)
                      }}
                      style={{ ...selectStyle, width: 160 }}
                    >
                      {[
                        ['01','January'],['02','February'],['03','March'],['04','April'],
                        ['05','May'],['06','June'],['07','July'],['08','August'],
                        ['09','September'],['10','October'],['11','November'],['12','December'],
                      ].map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Start day</label>
                    <select
                      value={holidayYearStart.split('-')[1] ?? '01'}
                      onChange={e => {
                        const month = holidayYearStart.split('-')[0]
                        saveHolidayYearStart(`${month}-${e.target.value}`)
                      }}
                      style={{ ...selectStyle, width: 100 }}
                    >
                      {(() => {
                        const month = parseInt(holidayYearStart.split('-')[0] ?? '1')
                        // Use year 2000 (leap year) to get correct Feb days
                        const daysInMonth = new Date(2000, month, 0).getDate()
                        return Array.from({ length: daysInMonth }, (_, i) =>
                          String(i + 1).padStart(2, '0')
                        ).map(d => (
                          <option key={d} value={d}>{parseInt(d)}</option>
                        ))
                      })()}
                    </select>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', paddingBottom: 6 }}>
                    {holidayYearSaving ? 'Saving…' : (
                      <>Current: <strong>
                        {new Date(`2000-${holidayYearStart}`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                      </strong> each year</>
                    )}
                  </div>
                </div>
              </div>
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
                    {[holidayYearLabel - 1, holidayYearLabel, holidayYearLabel + 1].map(y => <option key={y} value={y}>Holiday year {y}</option>)}
                  </select>
                  <Btn variant="primary" size="sm" onClick={() => {
                    setAlEditing(null)
                    setAlForm({ userId: employees[0]?.id ?? '', typeId: leaveTypes[0]?.id ?? '', year: alYear, total: '', note: '' })
                    setAlModal(true)
                  }}>+ Add allowance</Btn>
                </div>
              </div>

              <Table headers={['Employee', 'Leave type', 'Total', 'Used', 'Remaining', 'Actions']} empty={`No allowances seeded for holiday year ${alYear}. Use Admin → Overview → Seed allowances.`}>
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

      {/* ── Approve / Reject / Cancellation modal ── */}
      <Modal open={!!actionModal} onClose={() => setActionModal(null)} title={
        actionModal?.action === 'approve'              ? 'Approve request' :
        actionModal?.action === 'reject'               ? 'Reject request' :
        actionModal?.action === 'approve_cancellation' ? 'Approve cancellation' :
        'Reject cancellation'
      }>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: '1rem' }}>
          {actionModal?.action === 'approve'              && 'Optionally leave a note for the employee before approving.'}
          {actionModal?.action === 'reject'               && 'Please provide a reason for rejecting this request.'}
          {actionModal?.action === 'approve_cancellation' && 'The leave will be cancelled and the days returned to the employee\'s allowance.'}
          {actionModal?.action === 'reject_cancellation'  && 'The leave will remain approved. Optionally explain why the cancellation was declined.'}
        </p>
        <Field label={
          actionModal?.action === 'approve'              ? 'Note for employee (optional)' :
          actionModal?.action === 'reject'               ? 'Reason for rejection' :
          actionModal?.action === 'approve_cancellation' ? 'Note for employee (optional)' :
          'Reason for declining cancellation'
        }>
          <textarea
            value={actionNote}
            onChange={e => setActionNote(e.target.value)}
            rows={3}
            placeholder={
              actionModal?.action === 'approve'              ? 'e.g. Approved, enjoy your break!' :
              actionModal?.action === 'reject'               ? 'e.g. Insufficient cover during this period' :
              actionModal?.action === 'approve_cancellation' ? 'e.g. Cancellation approved, days returned to your balance' :
              'e.g. Cover has already been arranged for this period'
            }
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
          <Btn size="sm" onClick={() => setActionModal(null)}>Cancel</Btn>
          <Btn size="sm"
            variant={actionModal?.action === 'approve' || actionModal?.action === 'approve_cancellation' ? 'primary' : 'danger'}
            onClick={confirmAction}
            disabled={actionModal?.action === 'reject' && !actionNote.trim()}>
            {actionModal?.action === 'approve'              && 'Confirm approval'}
            {actionModal?.action === 'reject'               && 'Confirm rejection'}
            {actionModal?.action === 'approve_cancellation' && 'Approve cancellation'}
            {actionModal?.action === 'reject_cancellation'  && 'Reject cancellation'}
          </Btn>
        </div>
      </Modal>

      {/* ── Add user / invite modal ── */}
      <Modal open={addUserModal} onClose={() => { setAddUserModal(false); setInviteLink(null) }} title="Add user">

        {inviteLink ? (
          /* Success state — invite email sent by Supabase */
          <div>
            <div style={{ fontSize:32, textAlign:'center', marginBottom:8 }}>✉️</div>
            <div style={{ fontSize:14, fontWeight:500, textAlign:'center', marginBottom:8 }}>
              Invite sent to {inviteLink.name}
            </div>
            <div style={{ fontSize:13, color:'#065f46', background:'#d1fae5', borderRadius:8, padding:'0.75rem', marginBottom:'1rem', border:'0.5px solid #6ee7b7', textAlign:'center' }}>
              An email has been sent to <strong>{inviteLink.email}</strong> with a sign-in link.
            </div>
            <div style={{ fontSize:12, color:'#6b7280', marginBottom:'1rem', lineHeight:1.6 }}>
              When they click the link in the email, their account will be automatically
              configured with the role and department you set. The link expires in 24 hours.
              If they don't receive it, check their spam folder or resend from this panel.
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', borderTop:'0.5px solid #e5e7eb', paddingTop:'1rem' }}>
              <Btn size="sm" onClick={() => {
                setAddUserForm({ full_name:'', email:'', role:'employee', department:'', company:'', manager_id:'' })
                setInviteLink(null)
              }}>Invite another</Btn>
              <Btn size="sm" variant="primary" onClick={() => { setAddUserModal(false); setInviteLink(null) }}>Done</Btn>
            </div>
          </div>
        ) : (
          /* Form state */
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', borderRadius: 8, padding: '0.6rem 0.85rem', marginBottom: '1rem', border: '0.5px solid #e5e7eb', lineHeight: 1.6 }}>
              Fill in the details below and an invite link will be generated.
              Send it to the employee — when they sign up, their account will be automatically configured.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Full name *">
                <input style={inputStyle} value={addUserForm.full_name}
                  onChange={e => setAddUserForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="e.g. Jane Smith" />
              </Field>
              <Field label="Email address *">
                <input style={inputStyle} type="email" value={addUserForm.email}
                  onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="jane@company.com" />
              </Field>
            </div>
            <Field label="Role">
              <select style={selectStyle} value={addUserForm.role}
                onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Department">
                <input style={inputStyle} value={addUserForm.department}
                  onChange={e => setAddUserForm(f => ({ ...f, department: e.target.value }))}
                  placeholder="e.g. Care (Domiciliary)" />
              </Field>
              <Field label="Company">
                <input style={inputStyle} value={addUserForm.company}
                  onChange={e => setAddUserForm(f => ({ ...f, company: e.target.value }))}
                  placeholder="e.g. Axela Care" />
              </Field>
            </div>
            <Field label="Manager">
              <select style={selectStyle} value={addUserForm.manager_id}
                onChange={e => setAddUserForm(f => ({ ...f, manager_id: e.target.value }))}>
                <option value="">No manager assigned</option>
                {empList.filter(e => e.role === 'manager' || e.role === 'admin').map(e => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
              <Btn size="sm" onClick={() => setAddUserModal(false)}>Cancel</Btn>
              <Btn size="sm" variant="primary" onClick={createUser} disabled={addUserBusy}>
                {addUserBusy ? 'Creating…' : 'Create invite link'}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Employee edit modal ── */}
      <Modal open={empModal} onClose={() => setEmpModal(false)} title="Edit employee">
        <Field label="Full name">
          <input style={inputStyle} value={empForm.full_name} onChange={e => setEmpForm(f => ({ ...f, full_name: e.target.value }))} />
        </Field>
        <Field label="Role">
          <select style={selectStyle} value={empForm.role} onChange={e => setEmpForm(f => ({ ...f, role: e.target.value }))}>
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Company">
            <input style={inputStyle} value={empForm.company} onChange={e => setEmpForm(f => ({ ...f, company: e.target.value }))} placeholder="e.g. Axela" />
          </Field>
          <Field label="Department">
            <input style={inputStyle} value={empForm.department} onChange={e => setEmpForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Operations" />
          </Field>
        </div>
        <Field label="Manager">
          <select style={selectStyle} value={empForm.manager_id} onChange={e => setEmpForm(f => ({ ...f, manager_id: e.target.value }))}>
            <option value="">No manager assigned</option>
            {empList.filter(e => e.id !== empEditing && (e.role === 'manager' || e.role === 'admin')).map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '0.5px solid #e5e7eb', paddingTop: '1rem' }}>
          <Btn size="sm" onClick={() => setEmpModal(false)}>Cancel</Btn>
          <Btn size="sm" variant="primary" onClick={saveEmployee}>Save changes</Btn>
        </div>
      </Modal>

    </div>
  )
}


// ═══════════════════════════════════════════════════════════════
// AI REVIEW TAB  (self-contained, uses useState from React scope)
// ═══════════════════════════════════════════════════════════════

function AIReviewTab({ requests, employees }) {
  const [selectedId, setSelectedId] = React.useState(null)
  const [aiLoading,  setAiLoading]  = React.useState(false)
  const [aiResult,   setAiResult]   = React.useState(null)
  const [aiError,    setAiError]    = React.useState(null)
  const [decided,    setDecided]    = React.useState({})

  const pending  = requests.filter(r => r.status === 'pending')
  const selected = pending.find(r => r.id === selectedId)
  const fmtS = s => s ? new Date(s+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'}) : '—'

  const runAI = async (req) => {
    setAiLoading(true); setAiResult(null); setAiError(null)
    const deptName = req.user?.department ?? ''
    const deptSize = employees.filter(e => e.department === deptName).length
    const sys = `You are an intelligent leave approval assistant for a company leave management system.
Your role is to analyse leave requests and provide:
1. A recommendation: APPROVE, REVIEW, or REJECT
2. A confidence score from 0-100
3. A concise operational explanation
4. Any staffing or business risks detected
5. Suggested actions if applicable
Prioritise: maintaining adequate team coverage, avoiding operational risk, fairness, avoiding unnecessary rejection, employee wellbeing.
Rules: Never invent company policies. Only use supplied data. Keep explanations concise and business-focused. If risk is low, favour approval. If uncertain, return REVIEW not REJECT.
Output must be valid JSON only, with keys: recommendation, confidence, explanation, risks (array of strings), suggested_actions (array of strings).`
    const usr = `Analyse this leave request:
Employee: ${req.user?.full_name??'Unknown'}  Role: ${req.user?.role??'employee'}
Department size: ${deptSize||'unknown'} staff
Leave type: ${req.leave_types?.name??'Unknown'}
Dates: ${req.start_date} to ${req.end_date}  Duration: ${req.days_requested} working days
Reason: ${req.reason??'Not provided'}
Conflict flagged: ${req.conflict_flag?'Yes':'No'}
Conflict detail: ${req.conflict_detail??'None'}`
    try {
      const res  = await fetch('https://api.anthropic.com/v1/messages',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:800, system:sys, messages:[{role:'user',content:usr}] }) })
      const data = await res.json()
      const raw  = (data.content??[]).map(b=>b.text??'').join('')
      setAiResult(JSON.parse(raw.replace(/```json|```/g,'').trim()))
    } catch(e) { setAiError(e.message) }
    finally { setAiLoading(false) }
  }

  const RC = { APPROVE:{bg:'#E1F5EE',color:'#085041'}, REVIEW:{bg:'#FAEEDA',color:'#633806'}, REJECT:{bg:'#FCEBEB',color:'#791F1F'} }

  return (
    <div>
      <div style={{marginBottom:'1.25rem'}}>
        <div style={{fontSize:15,fontWeight:500}}>AI review</div>
        <div style={{fontSize:13,color:'#6b7280',marginTop:2}}>Claude analyses each pending request for conflicts and coverage risk. You make the final call.</div>
      </div>
      {pending.length===0 ? (
        <div style={{padding:'3rem',textAlign:'center',color:'#9ca3af',fontSize:13,border:'0.5px dashed #e5e7eb',borderRadius:8}}>No pending requests to review.</div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:12}}>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'0.5rem'}}>Pending ({pending.filter(r=>!decided[r.id]).length})</div>
            <div style={{border:'0.5px solid #e5e7eb',borderRadius:10,overflow:'hidden'}}>
              {pending.map((r,i)=>(
                <div key={r.id} onClick={()=>{if(!decided[r.id]){setSelectedId(r.id);runAI(r)}}}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'0.65rem 0.85rem',borderBottom:i<pending.length-1?'0.5px solid #f3f4f6':'none',cursor:decided[r.id]?'default':'pointer',background:selectedId===r.id?'#f0fdf4':'transparent',opacity:decided[r.id]?0.4:1}}>
                  <div style={{width:30,height:30,borderRadius:'50%',background:'#E1F5EE',color:'#085041',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:500,flexShrink:0}}>
                    {(r.user?.full_name??'?').split(' ').map(x=>x[0]).join('')}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:500,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {r.user?.full_name??'—'}{r.conflict_flag&&<span style={{marginLeft:4,fontSize:10,color:'#854F0B'}}>⚠</span>}
                    </div>
                    <div style={{fontSize:11,color:'#9ca3af'}}>{fmtS(r.start_date)} · {r.days_requested}d</div>
                  </div>
                  {decided[r.id]&&<span style={{fontSize:10,fontWeight:500,padding:'1px 6px',borderRadius:8,background:decided[r.id]==='approved'?'#E1F5EE':'#FCEBEB',color:decided[r.id]==='approved'?'#085041':'#791F1F'}}>{decided[r.id]}</span>}
                </div>
              ))}
            </div>
          </div>
          <div>
            {!selectedId&&<div style={{padding:'3rem 0',textAlign:'center',color:'#9ca3af',fontSize:13}}>← Select a request to run AI analysis</div>}
            {selectedId&&aiLoading&&(
              <div style={{border:'0.5px solid #e5e7eb',borderRadius:10,padding:'2.5rem',textAlign:'center'}}>
                <div style={{display:'inline-block',width:18,height:18,border:'2px solid #e5e7eb',borderTopColor:'#1D9E75',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>
                <div style={{marginTop:12,fontSize:13,color:'#9ca3af'}}>Analysing with AI…</div>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}
            {selectedId&&!aiLoading&&aiError&&(
              <div style={{border:'0.5px solid #fca5a5',borderRadius:10,padding:'1.25rem',color:'#991b1b',fontSize:13}}>AI analysis failed: {aiError}</div>
            )}
            {selectedId&&!aiLoading&&aiResult&&selected&&(
              <div style={{border:'0.5px solid #e5e7eb',borderRadius:10,overflow:'hidden'}}>
                <div style={{padding:'0.85rem 1rem',borderBottom:'0.5px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#fafafa'}}>
                  <div>
                    <div style={{fontWeight:500,fontSize:13}}>{selected.user?.full_name}</div>
                    <div style={{fontSize:11,color:'#9ca3af'}}>{selected.leave_types?.name} · {fmtS(selected.start_date)}–{fmtS(selected.end_date)} · {selected.days_requested}d{selected.conflict_flag&&<span style={{marginLeft:6,color:'#854F0B'}}>⚠ conflict</span>}</div>
                  </div>
                  <span style={{display:'inline-flex',padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:500,...RC[aiResult.recommendation]}}>{aiResult.recommendation}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:'0.85rem 1rem',borderBottom:'0.5px solid #e5e7eb'}}>
                  <div style={{background:'#f9fafb',borderRadius:8,padding:'0.65rem 0.75rem'}}>
                    <div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>Confidence</div>
                    <div style={{fontSize:18,fontWeight:500}}>{aiResult.confidence}%</div>
                    <div style={{height:4,borderRadius:2,background:'#e5e7eb',overflow:'hidden',marginTop:4}}><div style={{width:`${aiResult.confidence}%`,height:'100%',background:aiResult.confidence>70?'#1D9E75':aiResult.confidence>40?'#EF9F27':'#E24B4A',borderRadius:2}}/></div>
                  </div>
                  <div style={{background:'#f9fafb',borderRadius:8,padding:'0.65rem 0.75rem'}}>
                    <div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>Risks flagged</div>
                    <div style={{fontSize:18,fontWeight:500}}>{aiResult.risks?.length??0}</div>
                    <div style={{fontSize:10,color:'#9ca3af'}}>from AI analysis</div>
                  </div>
                </div>
                <div style={{padding:'1rem'}}>
                  <div style={{fontSize:11,fontWeight:500,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'0.4rem'}}>Assessment</div>
                  <p style={{fontSize:13,color:'#374151',lineHeight:1.6,marginBottom:'1rem'}}>{aiResult.explanation}</p>
                  {aiResult.risks?.length>0&&(
                    <div style={{marginBottom:'1rem'}}>
                      <div style={{fontSize:11,fontWeight:500,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'0.4rem'}}>Risks</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{aiResult.risks.map((r,i)=><span key={i} style={{fontSize:11,padding:'3px 8px',borderRadius:12,border:'0.5px solid #e5e7eb',background:'#fafafa',color:'#6b7280'}}>⚠ {r}</span>)}</div>
                    </div>
                  )}
                  {aiResult.suggested_actions?.length>0&&(
                    <div style={{marginBottom:'1rem'}}>
                      <div style={{fontSize:11,fontWeight:500,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'0.4rem'}}>Suggested actions</div>
                      {aiResult.suggested_actions.map((a,i)=><div key={i} style={{fontSize:12,color:'#374151',padding:'4px 0',borderBottom:'0.5px solid #f3f4f6',display:'flex',gap:8}}><span style={{color:'#1D9E75'}}>→</span>{a}</div>)}
                    </div>
                  )}
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',borderTop:'0.5px solid #e5e7eb',paddingTop:'1rem'}}>
                    <button onClick={()=>setDecided(d=>({...d,[selectedId]:'rejected'}))} style={{fontSize:12,padding:'0.35rem 0.75rem',border:'0.5px solid #fca5a5',borderRadius:8,background:'transparent',color:'#991b1b',cursor:'pointer',fontFamily:'inherit'}}>Reject</button>
                    <button onClick={()=>setDecided(d=>({...d,[selectedId]:'review'}))} style={{fontSize:12,padding:'0.35rem 0.75rem',border:'0.5px solid #fcd34d',borderRadius:8,background:'transparent',color:'#92400e',cursor:'pointer',fontFamily:'inherit'}}>Flag for review</button>
                    <button onClick={()=>setDecided(d=>({...d,[selectedId]:'approved'}))} style={{fontSize:12,padding:'0.35rem 0.75rem',border:'none',borderRadius:8,background:'#1D9E75',color:'#fff',cursor:'pointer',fontFamily:'inherit'}}>Approve</button>
                  </div>
                  <p style={{fontSize:11,color:'#9ca3af',marginTop:'0.5rem',textAlign:'right'}}>Decisions are UI-only — wire to Supabase in Claude Code.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
