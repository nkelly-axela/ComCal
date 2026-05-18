/**
 * src/components/LeaveCalendar.jsx
 * ─────────────────────────────────────────────────────────────
 * Team-wide calendar — approved + pending leave.
 *
 * New in this version:
 *   • Shows approved AND pending leave (pending = amber dashed)
 *   • Conflict badges: days where ≥2 dept members overlap are
 *     flagged with a red dot; click to open conflict drawer
 *   • Conflict drawer uses position:absolute (not position:fixed)
 *     anchored to the wrapper div — fixes the iframe height bug
 *   • Status filter: All / Approved only / Pending only
 *   • Department staff count shown in timeline group headers
 *
 * Data: public.v_team_calendar (migration_05)
 *   Exposes approved + pending, no reason/admin_note.
 * ─────────────────────────────────────────────────────────────
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─── Date helpers ─────────────────────────────────────────────
const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LONG = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const isWeekend = d => { const dow = d.getDay(); return dow === 0 || dow === 6 }
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day:'numeric', month:'short' })
const fmtDateLong = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day:'numeric', month:'long', year:'numeric' })

function requestDaysInMonth(r, year, month) {
  const monthStart = new Date(year, month, 1)
  const monthEnd   = new Date(year, month + 1, 0)
  const start = new Date(r.start_date + 'T00:00:00')
  const end   = new Date(r.end_date   + 'T00:00:00')
  return {
    from: start < monthStart ? 1 : start.getDate(),
    to:   end   > monthEnd   ? monthEnd.getDate() : end.getDate(),
  }
}

const B  = '0.5px solid #e5e7eb'
const BL = '0.5px solid #f3f4f6'

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function LeaveCalendar() {
  const today = new Date()

  const [year,         setYear]         = useState(today.getFullYear())
  const [month,        setMonth]        = useState(today.getMonth())
  const [requests,     setRequests]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [view,         setView]         = useState('timeline')
  const [deptFilter,   setDeptFilter]   = useState('all')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error,        setError]        = useState(null)
  const [drawer,       setDrawer]       = useState(null) // { day, conflicts[] }

  const dim = daysInMonth(year, month)

  // ── Load ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const monthStart = new Date(year, month, 1)
    const monthEnd   = new Date(year, month + 1, 0)
    const { data, error } = await supabase
      .from('v_team_calendar')
      .select('id,start_date,end_date,days_requested,hours_requested,status,conflict_flag,user_id,leave_type_id,leave_type_name,leave_type_color,full_name,department,role')
      .gte('end_date',   ymd(monthStart))
      .lte('start_date', ymd(monthEnd))
      .order('start_date', { ascending: true })
    if (error) {
      setError(error.message)
    } else {
      setRequests((data ?? []).map(r => ({
        ...r,
        user:        { full_name:r.full_name, department:r.department??null, role:r.role },
        leave_types: { name:r.leave_type_name, color:r.leave_type_color },
      })))
    }
    setLoading(false)
  }, [year, month])

  useEffect(() => { load() }, [load])

  // ── Derived ───────────────────────────────────────────────────
  const departments = useMemo(() => {
    const s = new Set(); requests.forEach(r => s.add(r.user?.department??'Unassigned')); return Array.from(s).sort()
  }, [requests])

  const leaveTypes = useMemo(() => {
    const m = new Map(); requests.forEach(r => { if (r.leave_type_id) m.set(r.leave_type_id, r.leave_types) })
    return Array.from(m.entries()).map(([id,lt]) => ({ id, ...lt }))
  }, [requests])

  const filtered = useMemo(() => requests.filter(r => {
    if (deptFilter   !== 'all' && (r.user?.department??'Unassigned') !== deptFilter)   return false
    if (typeFilter   !== 'all' && r.leave_type_id !== typeFilter)                      return false
    if (statusFilter !== 'all' && r.status        !== statusFilter)                    return false
    return true
  }), [requests, deptFilter, typeFilter, statusFilter])

  // Conflict map: day → requests[] where ≥2 dept members overlap
  const conflictMap = useMemo(() => {
    const byDay = {}
    requests.forEach(r => {
      const dept = r.user?.department ?? 'Unassigned'
      const { from, to } = requestDaysInMonth(r, year, month)
      for (let d = from; d <= to; d++) {
        if (!byDay[d]) byDay[d] = {}
        if (!byDay[d][dept]) byDay[d][dept] = []
        byDay[d][dept].push(r)
      }
    })
    const out = {}
    Object.entries(byDay).forEach(([day, depts]) => {
      const clashing = []
      Object.values(depts).forEach(reqs => { if (reqs.length >= 2) clashing.push(...reqs) })
      if (clashing.length) out[+day] = clashing
    })
    return out
  }, [requests, year, month])

  const pendingCount = useMemo(() => requests.filter(r => r.status === 'pending').length, [requests])

  // ── Nav ───────────────────────────────────────────────────────
  const prevMonth = () => { if (month===0){setYear(y=>y-1);setMonth(11)}else setMonth(m=>m-1) }
  const nextMonth = () => { if (month===11){setYear(y=>y+1);setMonth(0)}else setMonth(m=>m+1) }
  const goToday   = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }

  return (
    // position:relative anchors the absolute conflict drawer — no position:fixed needed
    <div style={{ background:'#fff', borderRadius:12, border:B, padding:'1.5rem', position:'relative' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:'1rem' }}>
        <div>
          <div style={{ fontSize:16, fontWeight:500 }}>Team calendar</div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
            <span style={{ fontSize:13, color:'#6b7280' }}>Approved and pending time off</span>
            {pendingCount > 0 && (
              <span style={{ background:'#FAEEDA', color:'#854F0B', fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:20 }}>
                {pendingCount} pending
              </span>
            )}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <NavBtn onClick={prevMonth}>‹</NavBtn>
          <div style={{ minWidth:130, textAlign:'center', fontSize:14, fontWeight:500 }}>{MONTHS[month]} {year}</div>
          <NavBtn onClick={nextMonth}>›</NavBtn>
          <NavBtn onClick={goToday} style={{ marginLeft:4 }}>Today</NavBtn>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:'1rem' }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <CalSelect value={deptFilter}   onChange={setDeptFilter}   options={[{ value:'all', label:'All departments' }, ...departments.map(d=>({ value:d, label:d }))]} />
          <CalSelect value={typeFilter}   onChange={setTypeFilter}   options={[{ value:'all', label:'All leave types' }, ...leaveTypes.map(lt=>({ value:lt.id, label:lt.name }))]} />
          <CalSelect value={statusFilter} onChange={setStatusFilter} options={[{ value:'all', label:'Approved + pending' }, { value:'approved', label:'Approved only' }, { value:'pending', label:'Pending only' }]} />
        </div>
        <div style={{ display:'flex', gap:4, padding:3, background:'#f3f4f6', borderRadius:8 }}>
          <CalToggleBtn active={view==='timeline'} onClick={()=>setView('timeline')}>Timeline</CalToggleBtn>
          <CalToggleBtn active={view==='month'}    onClick={()=>setView('month')}>Month grid</CalToggleBtn>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:14, marginBottom:'1rem', fontSize:11, color:'#6b7280', flexWrap:'wrap' }}>
        <LegendItem color="#1D9E75" label="Approved" />
        <LegendItem color="#EF9F27" dashed label="Pending" />
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'#E24B4A', display:'inline-block' }} />
          Department conflict (click)
        </span>
      </div>

      {/* Body */}
      {loading ? (
        <div style={emptyStyle}>Loading leave data…</div>
      ) : error ? (
        <div style={{ ...emptyStyle, color:'#991b1b' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>No leave in {MONTHS[month]} {year}.</div>
      ) : view === 'timeline' ? (
        <TimelineView requests={filtered} allRequests={requests} year={year} month={month} dim={dim} conflictMap={conflictMap} onConflictClick={(d,rs)=>setDrawer({day:d,conflicts:rs})} />
      ) : (
        <MonthGridView requests={filtered} year={year} month={month} dim={dim} conflictMap={conflictMap} onConflictClick={(d,rs)=>setDrawer({day:d,conflicts:rs})} />
      )}

      {/* Conflict drawer — position:absolute on position:relative parent (no fixed!) */}
      {drawer && (
        <div onClick={()=>setDrawer(null)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.28)', borderRadius:12, zIndex:20, display:'flex', alignItems:'flex-start', justifyContent:'flex-end' }}>
          <div onClick={e=>e.stopPropagation()} style={{ width:340, background:'#fff', borderRadius:'0 12px 12px 0', border:B, padding:'1.25rem', alignSelf:'stretch', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <div style={{ fontSize:14, fontWeight:500 }}>
                Conflicts — {fmtDateLong(`${year}-${String(month+1).padStart(2,'0')}-${String(drawer.day).padStart(2,'0')}`)}
              </div>
              <button onClick={()=>setDrawer(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#6b7280', lineHeight:1, padding:0 }}>×</button>
            </div>
            <div style={{ fontSize:12, color:'#854F0B', background:'#FAEEDA', borderRadius:6, padding:'0.5rem 0.75rem', marginBottom:'1rem', borderLeft:'3px solid #BA7517' }}>
              {drawer.conflicts.length} team members off — review coverage before approving pending requests.
            </div>
            {drawer.conflicts.map(r => (
              <div key={r.id} style={{ padding:'0.65rem 0', borderBottom:BL }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:r.status==='approved'?'#1D9E75':'#EF9F27', flexShrink:0 }} />
                  <span style={{ fontWeight:500, fontSize:13 }}>{r.user?.full_name}</span>
                  <span style={{ fontSize:11, color:'#9ca3af', marginLeft:'auto', textTransform:'capitalize', background:r.status==='approved'?'#E1F5EE':'#FAEEDA', padding:'1px 6px', borderRadius:10, color:r.status==='approved'?'#085041':'#633806' }}>{r.status}</span>
                </div>
                <div style={{ fontSize:12, color:'#6b7280', paddingLeft:15 }}>
                  <ColorDot color={r.leave_types?.color} />{r.leave_types?.name} · {fmtDate(r.start_date)} – {fmtDate(r.end_date)}
                  {r.days_requested > 0 && <> · {r.days_requested}d</>}
                </div>
                {r.user?.department && <div style={{ fontSize:11, color:'#9ca3af', paddingLeft:15, marginTop:2 }}>{r.user.department}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Timeline view
// ═══════════════════════════════════════════════════════════════

function TimelineView({ requests, allRequests, year, month, dim, conflictMap, onConflictClick }) {
  const today      = new Date()
  const monthStart = new Date(year, month, 1)
  const monthEnd   = new Date(year, month + 1, 0)

  const grouped = useMemo(() => {
    const byDept = {}
    requests.forEach(r => {
      const dept = r.user?.department ?? 'Unassigned'
      const uid  = r.user_id
      if (!byDept[dept])     byDept[dept] = {}
      if (!byDept[dept][uid]) byDept[dept][uid] = { id:uid, name:r.user?.full_name??'Unknown', role:r.user?.role, requests:[] }
      byDept[dept][uid].requests.push(r)
    })
    return Object.entries(byDept).map(([dept, users]) => ({ dept, users:Object.values(users) }))
  }, [requests])

  const days = useMemo(() => Array.from({ length:dim }, (_,i) => {
    const d = new Date(year, month, i+1)
    return { day:i+1, weekend:isWeekend(d) }
  }), [year, month, dim])

  return (
    <div style={{ border:B, borderRadius:8, overflow:'hidden' }}>
      {/* Day header */}
      <div style={{ display:'flex', borderBottom:B, background:'#fafafa' }}>
        <div style={{ minWidth:180, padding:'6px 12px', fontSize:11, color:'#6b7280', fontWeight:500, flexShrink:0 }}>Person</div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${dim},1fr)`, flex:1 }}>
          {days.map(d => {
            const isToday      = year===today.getFullYear() && month===today.getMonth() && d.day===today.getDate()
            const hasConflict  = !!conflictMap[d.day]
            return (
              <div key={d.day}
                onClick={() => hasConflict && onConflictClick(d.day, conflictMap[d.day])}
                title={hasConflict ? 'Department conflict — click for details' : undefined}
                style={{ fontSize:10, textAlign:'center', padding:'4px 0 6px', color:isToday?'#1D9E75':d.weekend?'#d1d5db':'#6b7280', fontWeight:isToday?700:400, background:d.weekend?'#f3f4f6':undefined, position:'relative', cursor:hasConflict?'pointer':'default' }}
              >
                {d.day}
                {hasConflict && <span style={{ position:'absolute', bottom:2, left:'50%', transform:'translateX(-50%)', width:4, height:4, borderRadius:'50%', background:'#E24B4A' }} />}
              </div>
            )
          })}
        </div>
      </div>

      {grouped.map(({ dept, users }) => {
        const deptAll  = allRequests.filter(r => r.user?.department === dept)
        const deptSize = new Set(deptAll.map(r => r.user_id)).size
        return (
          <Fragment key={dept}>
            <div style={{ padding:'4px 12px', fontSize:10, fontWeight:600, color:'#9ca3af', background:'#fafafa', borderBottom:BL, textTransform:'uppercase', letterSpacing:'0.05em', display:'flex', justifyContent:'space-between' }}>
              <span>{dept}</span>
              <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0 }}>{deptSize} staff</span>
            </div>
            {users.map(user => <UserTimelineRow key={user.id} user={user} days={days} dim={dim} monthStart={monthStart} monthEnd={monthEnd} />)}
          </Fragment>
        )
      })}
    </div>
  )
}

function UserTimelineRow({ user, days, dim, monthStart, monthEnd }) {
  return (
    <div style={{ display:'flex', borderBottom:BL, minHeight:44 }}>
      <div style={{ minWidth:180, maxWidth:180, padding:'0 12px', display:'flex', flexDirection:'column', justifyContent:'center', flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'#111', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user.name}</div>
        {user.role && <div style={{ fontSize:10, color:'#d1d5db', marginTop:1, textTransform:'capitalize' }}>{user.role}</div>}
      </div>
      <div style={{ position:'relative', display:'grid', gridTemplateColumns:`repeat(${dim},1fr)`, flex:1 }}>
        {days.map(d => <div key={d.day} style={{ background:d.weekend?'#fafafa':'#fff', borderLeft:BL, height:44 }} />)}
        {user.requests.map(r => {
          const start    = new Date(r.start_date + 'T00:00:00')
          const end      = new Date(r.end_date   + 'T00:00:00')
          const startDay = start < monthStart ? 1           : start.getDate()
          const endDay   = end   > monthEnd   ? days.length : end.getDate()
          const left     = ((startDay-1)/dim)*100
          const width    = ((endDay-startDay+1)/dim)*100
          const isPending = r.status === 'pending'
          const color     = isPending ? '#EF9F27' : (r.leave_types?.color ?? '#9CA3AF')
          return (
            <div key={r.id}
              title={`${r.leave_types?.name??'Leave'}\n${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}\n${r.days_requested}d${isPending?' (pending)':''}`}
              style={{
                position:'absolute', left:`${left}%`, width:`calc(${width}% - 4px)`,
                top:6, bottom:6, marginLeft:2, boxSizing:'border-box',
                background: isPending ? `${color}35` : `${color}cc`,
                border:`1.5px ${isPending?'dashed':'solid'} ${color}`,
                borderRadius:4, padding:'0 8px', fontSize:11, fontWeight:500,
                display:'flex', alignItems:'center', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                color: isPending ? '#92400e' : '#fff',
              }}>
              {isPending && '⏳ '}{r.leave_types?.name}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Month grid view
// ═══════════════════════════════════════════════════════════════

function MonthGridView({ requests, year, month, dim, conflictMap, onConflictClick }) {
  const dayMap = useMemo(() => {
    const out = {}
    for (let d=1; d<=dim; d++) out[d] = []
    requests.forEach(r => {
      const { from, to } = requestDaysInMonth(r, year, month)
      for (let d=from; d<=to; d++) out[d].push(r)
    })
    return out
  }, [requests, year, month, dim])

  const cells = useMemo(() => {
    const firstDow = (new Date(year, month, 1).getDay()+6) % 7
    const arr = []
    for (let i=0; i<firstDow; i++) arr.push(null)
    for (let i=1; i<=dim; i++) arr.push(i)
    while (arr.length%7!==0) arr.push(null)
    return arr
  }, [year, month, dim])

  const todayStr = ymd(new Date())

  return (
    <div style={{ border:B, borderRadius:8, overflow:'hidden' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'#fafafa', borderBottom:B }}>
        {DOW_LONG.map(l => <div key={l} style={{ padding:'8px 10px', fontSize:11, color:'#6b7280', fontWeight:500 }}>{l}</div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ minHeight:110, background:'#fafafa', borderRight:BL, borderBottom:BL }} />
          const weekend     = isWeekend(new Date(year,month,d))
          const isToday     = ymd(new Date(year,month,d)) === todayStr
          const items       = dayMap[d] ?? []
          const hasConflict = !!conflictMap[d]
          return (
            <div key={i}
              onClick={() => hasConflict && onConflictClick(d, conflictMap[d])}
              style={{ minHeight:110, padding:6, background:weekend?'#fafafa':'#fff', borderRight:BL, borderBottom:BL, display:'flex', flexDirection:'column', gap:3, cursor:hasConflict?'pointer':'default', outline:hasConflict?'1px solid #fca5a5':'none', outlineOffset:-1 }}
            >
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontSize:11, fontWeight:500, color:isToday?'#fff':'#374151', background:isToday?'#1D9E75':'transparent', width:20, height:20, lineHeight:'20px', borderRadius:'50%', textAlign:'center' }}>{d}</div>
                {hasConflict && <span title="Department conflict" style={{ width:6, height:6, borderRadius:'50%', background:'#E24B4A' }} />}
              </div>
              {items.slice(0,3).map(r => {
                const isPending = r.status === 'pending'
                const color     = r.leave_types?.color ?? '#9CA3AF'
                return (
                  <div key={r.id}
                    title={`${r.user?.full_name}\n${r.leave_types?.name??'Leave'}\n${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}${isPending?' (pending)':''}`}
                    style={{ background:isPending?'transparent':color, border:isPending?`1.5px dashed ${color}`:'none', color:isPending?color:'#fff', fontSize:10, padding:'2px 6px', borderRadius:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {compactName(r.user?.full_name)}{isPending?' ⏳':''}
                  </div>
                )
              })}
              {items.length > 3 && <div style={{ fontSize:10, color:'#6b7280', paddingLeft:4 }}>+{items.length-3} more</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Primitives ───────────────────────────────────────────────

function compactName(full) {
  if (!full) return '—'
  const parts = full.trim().split(/\s+/)
  return parts.length===1 ? parts[0] : `${parts[0]} ${parts[parts.length-1][0]}.`
}

const ColorDot = ({ color }) => <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background:color??'#9CA3AF', marginRight:4, verticalAlign:'middle' }} />

const LegendItem = ({ color, dashed, label }) => (
  <span style={{ display:'flex', alignItems:'center', gap:4 }}>
    <span style={{ width:12, height:8, borderRadius:2, background:dashed?'transparent':color, border:dashed?`1.5px dashed ${color}`:'none', display:'inline-block' }} />
    {label}
  </span>
)

const emptyStyle = { padding:'3rem 1rem', textAlign:'center', color:'#9ca3af', fontSize:13, border:'0.5px dashed #e5e7eb', borderRadius:8 }

function NavBtn({ children, onClick, style }) {
  return <button onClick={onClick} style={{ fontSize:13, padding:'0.35rem 0.7rem', border:B, background:'#fff', borderRadius:8, cursor:'pointer', fontFamily:'inherit', color:'#374151', ...style }}>{children}</button>
}
function CalToggleBtn({ active, children, onClick }) {
  return <button onClick={onClick} style={{ fontSize:12, padding:'0.3rem 0.7rem', border:'none', background:active?'#fff':'transparent', borderRadius:6, boxShadow:active?'0 1px 2px rgba(0,0,0,0.06)':'none', cursor:'pointer', fontFamily:'inherit', color:active?'#111':'#6b7280', fontWeight:active?500:400 }}>{children}</button>
}
function CalSelect({ value, onChange, options }) {
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{ fontSize:12, padding:'0.4rem 0.65rem', border:B, borderRadius:8, background:'#fff', color:'#374151', fontFamily:'inherit', cursor:'pointer' }}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
}
