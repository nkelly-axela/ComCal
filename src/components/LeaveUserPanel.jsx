/**
 * src/components/LeaveUserPanel.jsx
 * ─────────────────────────────────────────────────────────────
 * Employee-facing leave panel.
 *
 * New in this version:
 *   • Real-time conflict detection as user picks dates in the
 *     request modal — calls get_dept_conflicts() RPC, shows
 *     amber warning banners for overlapping colleagues.
 *   • conflict_flag + conflict_detail written to leave_requests
 *     on insert so admins can see flagged requests immediately.
 *   • position:fixed removed from toast and modal — they use
 *     position:absolute on the position:relative root div,
 *     which fixes the iframe height collapse bug.
 *
 * Props: { userId, userRole, fullName }
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────

function calcBusinessDays(startStr, endStr) {
  if (!startStr || !endStr) return 0
  const s = new Date(startStr), e = new Date(endStr)
  if (isNaN(s) || isNaN(e) || e < s) return 0
  let days = 0, cursor = new Date(s)
  while (cursor <= e) {
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) days++
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

const fmtDate = s => s ? new Date(s).toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' }) : '—'
const fmtShort = s => s ? new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day:'numeric', month:'short' }) : '—'

const STATUS_VARIANTS = {
  pending:              { variant:'amber', label:'Pending' },
  approved:             { variant:'green', label:'Approved' },
  rejected:             { variant:'red',   label:'Rejected' },
  cancelled:            { variant:'gray',  label:'Cancelled' },
  cancellation_pending: { variant:'amber', label:'Cancellation requested' },
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function LeaveUserPanel({ userId, fullName }) {
  const currentYear = new Date().getFullYear()
  const rootRef = useRef(null)

  const [balances,   setBalances]   = useState([])
  const [requests,   setRequests]   = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
  const [loading,    setLoading]    = useState(true)

  const [reqModal, setReqModal] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [form,     setForm]     = useState({ typeId:'', start:'', end:'', reason:'', isHourly:false, hours:'1', hourDate:'' })
  const [toast,    setToast]    = useState(null)

  // Conflict detection state
  const [conflicts,       setConflicts]       = useState([])
  const [conflictLoading, setConflictLoading] = useState(false)

  const showToast = (msg, type='success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Loaders ───────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_leave_balances').select('*')
      .eq('user_id', userId).eq('year', currentYear)
    if (error) showToast(error.message, 'error')
    else setBalances(data ?? [])
  }, [userId, currentYear])

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id,leave_type_id,start_date,end_date,days_requested,hours_requested,status,reason,admin_note,conflict_flag,created_at,leave_types(name,color)')
      .eq('user_id', userId)
      .order('start_date', { ascending:false })
      .limit(50)
    if (error) showToast(error.message, 'error')
    else setRequests(data ?? [])
  }, [userId])

  const loadLeaveTypes = useCallback(async () => {
    const { data, error } = await supabase
      .from('leave_types').select('id,name,color,requires_approval,max_days_per_year').order('name')
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

  // ── Conflict detection — runs when dates change in modal ──────
  const checkConflicts = useCallback(async (start, end) => {
    if (!start || !end || !userId) { setConflicts([]); return }
    if (new Date(end) < new Date(start)) { setConflicts([]); return }
    setConflictLoading(true)
    try {
      // Calls public.get_dept_conflicts(p_user_id, p_start, p_end) from migration_05
      const { data, error } = await supabase.rpc('get_dept_conflicts', {
        p_user_id: userId,
        p_start:   start,
        p_end:     end,
      })
      if (error) throw error
      setConflicts(data ?? [])
    } catch (e) {
      // Silently degrade — conflict check failing shouldn't block submission
      console.warn('Conflict check failed:', e.message)
      setConflicts([])
    } finally {
      setConflictLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!form.isHourly && form.start && form.end) {
      checkConflicts(form.start, form.end)
    } else {
      setConflicts([])
    }
  }, [form.start, form.end, form.isHourly, checkConflicts])

  // ── Submit ────────────────────────────────────────────────────
  const submitRequest = async () => {
    if (!form.typeId) { showToast('Pick a leave type', 'error'); return }

    if (form.isHourly) {
      if (!form.hourDate) { showToast('Pick a date', 'error'); return }
      const hrs = parseFloat(form.hours)
      if (!hrs || hrs <= 0 || hrs > 8) { showToast('Enter between 1 and 8 hours', 'error'); return }
      setBusy(true)
      try {
        const { error } = await supabase.from('leave_requests').insert({
          user_id: userId, leave_type_id: form.typeId,
          start_date: form.hourDate, end_date: form.hourDate,
          days_requested: 0, hours_requested: hrs,
          reason: form.reason || null, status: 'pending',
          conflict_flag: false, conflict_detail: null,
        })
        if (error) throw error
        showToast('Request submitted')
        resetModal()
        await loadRequests()
      } catch (e) { showToast(e.message, 'error') }
      finally { setBusy(false) }
      return
    }

    if (!form.start || !form.end) { showToast('Pick both dates', 'error'); return }
    if (new Date(form.end) < new Date(form.start)) { showToast("End date can't be before start", 'error'); return }
    const days = calcBusinessDays(form.start, form.end)
    if (days <= 0) { showToast('No working days in that range', 'error'); return }

    // Build conflict detail string for admin visibility
    const hasConflict   = conflicts.length > 0
    const conflictDetail = hasConflict
      ? conflicts.map(c => `${c.conflict_user_name} (${c.conflict_status}, ${fmtShort(c.conflict_start)}–${fmtShort(c.conflict_end)})`).join('; ')
      : null

    setBusy(true)
    try {
      const { error } = await supabase.from('leave_requests').insert({
        user_id: userId, leave_type_id: form.typeId,
        start_date: form.start, end_date: form.end,
        days_requested: days, hours_requested: null,
        reason: form.reason || null, status: 'pending',
        conflict_flag: hasConflict,
        conflict_detail: conflictDetail,
      })
      if (error) throw error
      showToast(hasConflict ? 'Request submitted — conflict flagged to manager' : 'Request submitted')
      resetModal()
      await loadRequests()
    } catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }

  const resetModal = () => {
    setReqModal(false)
    setForm({ typeId:'', start:'', end:'', reason:'', isHourly:false, hours:'1', hourDate:'' })
    setConflicts([])
  }

  const cancelRequest = async (id) => {
    if (!window.confirm('Cancel this request?')) return
    const { error } = await supabase
      .from('leave_requests').update({ status:'cancelled' })
      .eq('id', id).eq('user_id', userId).eq('status', 'pending')
    if (error) { showToast(error.message, 'error'); return }
    showToast('Request cancelled')
    await Promise.all([loadRequests(), loadBalances()])
  }

  const requestCancellation = async (id) => {
    if (!window.confirm('Request cancellation of this approved leave? Your manager will need to approve the cancellation.')) return
    const { error } = await supabase
      .from('leave_requests').update({ status:'cancellation_pending' })
      .eq('id', id).eq('user_id', userId).eq('status', 'approved')
    if (error) { showToast(error.message, 'error'); return }
    showToast('Cancellation request sent to your manager')
    await Promise.all([loadRequests(), loadBalances()])
  }

  const downloadICS = (r) => {
    const pad  = n => String(n).padStart(2, '0')
    const toICSDate = dateStr => {
      const d = new Date(dateStr + 'T00:00:00')
      return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`
    }
    // For all-day events ICS uses DATE not DATETIME, and end date is exclusive
    const endExclusive = dateStr => {
      const d = new Date(dateStr + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`
    }
    const now = new Date()
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}Z`
    const uid   = `leave-${r.id}@axela-leave`

    let dtStart, dtEnd, summary
    if (r.hours_requested) {
      // Hourly leave — use timed event
      dtStart  = `DTSTART;TZID=Europe/London:${toICSDate(r.start_date)}T090000`
      dtEnd    = `DTEND;TZID=Europe/London:${toICSDate(r.start_date)}T${pad(9 + Math.floor(r.hours_requested))}0000`
      summary  = `${r.leave_types?.name ?? 'Leave'} (${r.hours_requested}h)`
    } else {
      // Full-day leave — all-day event
      dtStart  = `DTSTART;VALUE=DATE:${toICSDate(r.start_date)}`
      dtEnd    = `DTEND;VALUE=DATE:${endExclusive(r.end_date)}`
      summary  = r.start_date === r.end_date
        ? `${r.leave_types?.name ?? 'Leave'}`
        : `${r.leave_types?.name ?? 'Leave'} (${r.days_requested} days)`
    }

    const description = [
      `Type: ${r.leave_types?.name ?? 'Leave'}`,
      r.hours_requested ? `Duration: ${r.hours_requested} hours` : `Duration: ${r.days_requested} day${r.days_requested===1?'':'s'}`,
      r.reason ? `Note: ${r.reason}` : null,
      `Status: ${r.status}`,
    ].filter(Boolean).join('\\n')

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Axela Leave Management//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      dtStart,
      dtEnd,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:Reminder: ${summary} tomorrow`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `leave-${r.start_date}${r.start_date !== r.end_date ? '-to-'+r.end_date : ''}.ics`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Calendar file downloaded')
  }

  const previewDays = calcBusinessDays(form.start, form.end)

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    // position:relative anchors the modal and toast without position:fixed
    <div ref={rootRef} style={{ fontFamily:'system-ui,sans-serif', color:'#111', position:'relative' }}>

      {/* Toast — position:absolute not fixed */}
      {toast && (
        <div style={{
          position:'absolute', top:0, right:0, zIndex:100,
          background: toast.type==='error' ? '#fee2e2' : '#d1fae5',
          color:       toast.type==='error' ? '#991b1b' : '#065f46',
          padding:'0.6rem 1rem', borderRadius:8, fontSize:13,
          border:`0.5px solid ${toast.type==='error'?'#fca5a5':'#6ee7b7'}`,
        }}>{toast.msg}</div>
      )}

      <div style={{ background:'#fff', borderRadius:12, border:'0.5px solid #e5e7eb', padding:'1.5rem' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'1.5rem' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:500 }}>Hi, {fullName?.split(' ')[0]??'there'}</div>
            <div style={{ fontSize:13, color:'#6b7280', marginTop:2 }}>Your leave for {currentYear}</div>
          </div>
          <Btn variant="primary" size="sm" onClick={() => {
            setForm({ typeId:leaveTypes[0]?.id??'', start:'', end:'', reason:'', isHourly:false, hours:'1', hourDate:'' })
            setConflicts([])
            setReqModal(true)
          }}>+ Request leave</Btn>
        </div>

        {/* Balance cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:12, marginBottom:'1.75rem' }}>
          {loading
            ? <div style={{ color:'#9ca3af', fontSize:13 }}>Loading balances…</div>
            : balances.length === 0
              ? <div style={{ color:'#9ca3af', fontSize:13 }}>No allowances seeded for {currentYear} yet. Ask an admin to run the seed.</div>
              : balances.map(b => <BalanceCard key={`${b.leave_type_id}-${b.year}`} b={b} />)}
        </div>

        {/* Requests table */}
        <div style={{ fontSize:14, fontWeight:500, marginBottom:'0.75rem' }}>Your requests</div>
        <Table headers={['Type','Dates','Duration','Status','Admin note','Actions']} empty="No requests yet">
          {requests.map(r => {
            const meta = STATUS_VARIANTS[r.status] ?? { variant:'gray', label:r.status }
            return (
              <TR key={r.id}>
                <TD>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <Swatch color={r.leave_types?.color} />
                    {r.leave_types?.name ?? 'Unknown'}
                    {r.conflict_flag && (
                      <span title="Conflict flagged to manager" style={{ fontSize:10, background:'#FAEEDA', color:'#854F0B', padding:'1px 5px', borderRadius:8, marginLeft:2 }}>⚠ conflict</span>
                    )}
                  </div>
                </TD>
                <TD>
                  <div>
                    {r.hours_requested
                      ? fmtDate(r.start_date)
                      : <>{fmtDate(r.start_date)}{r.start_date!==r.end_date&&<> → {fmtDate(r.end_date)}</>}</>}
                  </div>
                  {r.reason && <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{r.reason}</div>}
                </TD>
                <TD>{r.hours_requested ? `${r.hours_requested}h` : `${r.days_requested} day${r.days_requested===1?'':'s'}`}</TD>
                <TD><Badge variant={meta.variant}>{meta.label}</Badge></TD>
                <TD style={{ maxWidth:160 }}>
                  {r.admin_note
                    ? <span style={{ fontSize:12, color:r.status==='rejected'?'#991b1b':'#065f46', background:r.status==='rejected'?'#fee2e2':'#d1fae5', padding:'2px 8px', borderRadius:6 }}>{r.admin_note}</span>
                    : <span style={{ color:'#d1d5db' }}>—</span>}
                </TD>
                <TD>
                  <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                    {r.status === 'pending' && (
                      <Btn size="sm" variant="danger" onClick={() => cancelRequest(r.id)}>Cancel</Btn>
                    )}
                    {r.status === 'approved' && (
                      <Btn size="sm" variant="danger" onClick={() => requestCancellation(r.id)}>Request cancellation</Btn>
                    )}
                    {r.status === 'cancellation_pending' && (
                      <span style={{ fontSize:11, color:'#854F0B', background:'#FAEEDA', padding:'2px 8px', borderRadius:8 }}>
                        Awaiting manager
                      </span>
                    )}
                    {(r.status === 'approved' || r.status === 'pending') && !r.hours_requested && (
                      <Btn size="sm" onClick={() => downloadICS(r)} title="Add to calendar">
                        📅 .ics
                      </Btn>
                    )}
                    {(r.status === 'cancelled' || r.status === 'rejected') && (
                      <span style={{ color:'#d1d5db' }}>—</span>
                    )}
                  </div>
                </TD>
              </TR>
            )
          })}
        </Table>
      </div>

      {/* Request modal — position:absolute on position:relative root */}
      {reqModal && (
        <div onClick={resetModal} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, borderRadius:12 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:12, border:'0.5px solid #e5e7eb', padding:'1.5rem', width:460, maxWidth:'90%', maxHeight:'90vh', overflowY:'auto' }}>
            <h3 style={{ fontSize:15, fontWeight:500, marginBottom:'1rem' }}>Request leave</h3>

            <Field label="Leave type">
              <select style={inputStyle} value={form.typeId} onChange={e=>setForm(f=>({...f,typeId:e.target.value}))}>
                <option value="">Select…</option>
                {leaveTypes.map(lt=><option key={lt.id} value={lt.id}>{lt.name}</option>)}
              </select>
            </Field>

            {/* Hourly toggle */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.85rem', padding:'0.5rem 0.65rem', background:'#f9fafb', borderRadius:8, border:'0.5px solid #e5e7eb' }}>
              <span style={{ fontSize:13, color:'#374151' }}>Request by the hour</span>
              <MiniToggle checked={form.isHourly} onChange={v=>setForm(f=>({...f,isHourly:v}))} />
            </div>

            {form.isHourly ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <Field label="Date"><input style={inputStyle} type="date" value={form.hourDate} onChange={e=>setForm(f=>({...f,hourDate:e.target.value}))} /></Field>
                <Field label="Hours (1–8)">
                  <select style={inputStyle} value={form.hours} onChange={e=>setForm(f=>({...f,hours:e.target.value}))}>
                    {[1,2,3,4,5,6,7,8].map(h=><option key={h} value={h}>{h} hour{h>1?'s':''}</option>)}
                  </select>
                </Field>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <Field label="Start"><input style={inputStyle} type="date" value={form.start} onChange={e=>setForm(f=>({...f,start:e.target.value}))} /></Field>
                <Field label="End"><input style={inputStyle} type="date" value={form.end} min={form.start||undefined} onChange={e=>setForm(f=>({...f,end:e.target.value}))} /></Field>
              </div>
            )}

            {/* Conflict warnings */}
            {!form.isHourly && form.start && form.end && (
              <div style={{ marginBottom:'0.85rem' }}>
                {conflictLoading && (
                  <div style={{ fontSize:12, color:'#9ca3af', padding:'0.5rem 0' }}>Checking department conflicts…</div>
                )}
                {!conflictLoading && conflicts.length === 0 && previewDays > 0 && (
                  <div style={{ fontSize:12, color:'#065f46', background:'#d1fae5', borderRadius:6, padding:'0.5rem 0.75rem', borderLeft:'3px solid #1D9E75' }}>
                    No colleagues off during this period. Good to submit.
                  </div>
                )}
                {!conflictLoading && conflicts.length > 0 && (
                  <div style={{ fontSize:12, color:'#854F0B', background:'#FAEEDA', borderRadius:6, padding:'0.75rem', borderLeft:'3px solid #BA7517', marginBottom:6 }}>
                    <div style={{ fontWeight:500, marginBottom:4 }}>⚠ {conflicts.length} colleague{conflicts.length>1?'s are':' is'} off during this period</div>
                    {conflicts.map((c,i) => (
                      <div key={i} style={{ marginBottom:2 }}>
                        <strong>{c.conflict_user_name}</strong> — {c.conflict_type} ({c.conflict_status}) · {fmtShort(c.conflict_start)} – {fmtShort(c.conflict_end)}
                      </div>
                    ))}
                    <div style={{ marginTop:6, color:'#92400e', fontSize:11 }}>
                      Your request won't be blocked, but your manager will see this conflict before approving.
                    </div>
                  </div>
                )}
              </div>
            )}

            <Field label="Reason (optional)">
              <textarea value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} rows={3} placeholder="Anything your manager should know" style={{ ...inputStyle, fontFamily:'inherit', resize:'vertical' }} />
            </Field>

            <div style={{ background:'#f9fafb', border:'0.5px solid #e5e7eb', borderRadius:8, padding:'0.6rem 0.75rem', fontSize:12, color:'#374151', marginBottom:'0.85rem' }}>
              {form.isHourly
                ? form.hourDate && form.hours ? <>This will use <strong>{form.hours}h</strong> of leave on {fmtDate(form.hourDate)}.</> : <>Pick a date and hours.</>
                : previewDays > 0 ? <>This will use <strong>{previewDays}</strong> business day{previewDays===1?'':'s'}.</> : <>Pick a date range.</>}
            </div>

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', borderTop:'0.5px solid #e5e7eb', paddingTop:'1rem' }}>
              <Btn size="sm" onClick={resetModal}>Cancel</Btn>
              <Btn size="sm" variant="primary" onClick={submitRequest} disabled={busy}>
                {busy ? 'Submitting…' : conflicts.length > 0 ? 'Submit (conflict noted)' : 'Submit request'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Local primitives ─────────────────────────────────────────

function BalanceCard({ b }) {
  const pct  = b.total_days > 0 ? Math.round((b.used_days/b.total_days)*100) : 0
  const fill = pct>80?'#E24B4A':pct>50?'#EF9F27':'#1D9E75'
  return (
    <div style={{ background:'#f9fafb', borderRadius:10, border:'0.5px solid #e5e7eb', padding:'1rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <Swatch color={b.color} /><div style={{ fontSize:13, fontWeight:500 }}>{b.leave_type}</div>
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
        <div style={{ fontSize:26, fontWeight:600 }}>{b.remaining_days}</div>
        <div style={{ fontSize:12, color:'#6b7280' }}>of {b.total_days} days left</div>
      </div>
      <div style={{ height:5, background:'#e5e7eb', borderRadius:3, overflow:'hidden', marginTop:10 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:fill }} />
      </div>
      <div style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>{b.used_days} used · {b.year}</div>
    </div>
  )
}

const Swatch = ({ color }) => <span style={{ display:'inline-block', width:10, height:10, borderRadius:3, background:color??'#9CA3AF', flexShrink:0 }} />

const Badge = ({ children, variant='gray' }) => {
  const s = { green:{background:'#E1F5EE',color:'#0F6E56'}, amber:{background:'#FAEEDA',color:'#854F0B'}, gray:{background:'#F1EFE8',color:'#5F5E5A'}, red:{background:'#FCEBEB',color:'#A32D2D'}, blue:{background:'#E6F1FB',color:'#185FA5'} }
  return <span style={{ display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:500, ...s[variant] }}>{children}</span>
}

const Btn = ({ children, onClick, variant='default', size='md', disabled }) => {
  const base = { display:'inline-flex', alignItems:'center', gap:6, fontSize:size==='sm'?12:13, padding:size==='sm'?'0.3rem 0.65rem':'0.45rem 0.9rem', borderRadius:8, cursor:disabled?'not-allowed':'pointer', fontFamily:'inherit', transition:'all .15s', border:'0.5px solid #d1d5db', opacity:disabled?0.5:1 }
  const v = { default:{background:'transparent',color:'#111'}, primary:{background:'#1D9E75',border:'0.5px solid #1D9E75',color:'#fff'}, danger:{background:'transparent',border:'0.5px solid #fca5a5',color:'#991b1b'} }
  return <button onClick={disabled?undefined:onClick} style={{ ...base, ...v[variant] }}>{children}</button>
}

const inputStyle = { width:'100%', fontSize:13, padding:'0.45rem 0.65rem', border:'0.5px solid #d1d5db', borderRadius:8, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }

const Field = ({ label, children }) => (
  <div style={{ marginBottom:'0.85rem' }}>
    <label style={{ display:'block', fontSize:12, color:'#6b7280', marginBottom:4 }}>{label}</label>
    {children}
  </div>
)

const MiniToggle = ({ checked, onChange }) => (
  <label style={{ position:'relative', display:'inline-block', width:32, height:18, cursor:'pointer' }}>
    <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ opacity:0, width:0, height:0 }} />
    <span style={{ position:'absolute', inset:0, background:checked?'#1D9E75':'#d1d5db', borderRadius:9, transition:'.2s' }}>
      <span style={{ position:'absolute', width:12, height:12, left:checked?17:3, top:3, background:'#fff', borderRadius:'50%', transition:'.2s' }} />
    </span>
  </label>
)

const Table = ({ headers, children, empty }) => (
  <div style={{ border:'0.5px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
      <thead><tr>{headers.map(h=><th key={h} style={{ textAlign:'left', padding:'0.6rem 0.75rem', fontSize:11, fontWeight:500, color:'#6b7280', borderBottom:'0.5px solid #e5e7eb', textTransform:'uppercase', letterSpacing:'0.06em', background:'#fafafa' }}>{h}</th>)}</tr></thead>
      <tbody>
        {children}
        {!children||(Array.isArray(children)&&children.filter(Boolean).length===0)?(<tr><td colSpan={headers.length} style={{ textAlign:'center', padding:'2rem', color:'#9ca3af', fontSize:13 }}>{empty}</td></tr>):null}
      </tbody>
    </table>
  </div>
)

const TR = ({ children }) => <tr style={{ borderBottom:'0.5px solid #f3f4f6' }} onMouseEnter={e=>e.currentTarget.style.background='#fafafa'} onMouseLeave={e=>e.currentTarget.style.background=''}>{children}</tr>
const TD = ({ children, style }) => <td style={{ padding:'0.7rem 0.75rem', verticalAlign:'middle', ...style }}>{children}</td>
