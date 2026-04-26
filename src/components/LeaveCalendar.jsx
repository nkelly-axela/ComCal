/**
 * src/components/LeaveCalendar.jsx
 * ─────────────────────────────────────────────────────────────
 * Team-wide calendar of approved leave.
 *
 * Two views (toggle at top right):
 *   1. Timeline — rows = people (grouped by department),
 *                 columns = days of the selected month,
 *                 bars span their approved leave coloured by leave type.
 *   2. Month    — traditional 7-column calendar with name pills
 *                 inside each day cell.
 *
 * Data source:
 *   public.leave_requests (status='approved')
 *     joined with leave_types (name, color)
 *     joined with users (full_name, department, role)
 *
 * RLS reminder (see migration_04_calendar.sql): every authenticated
 * user must be able to SELECT approved rows in leave_requests for
 * this view to populate.
 * ─────────────────────────────────────────────────────────────
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─── Date helpers ────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_SHORT = ['M','T','W','T','F','S','S']
const DOW_LONG = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const isWeekend = (d) => { const dow = d.getDay(); return dow === 0 || dow === 6 }
const fmtDate = (s) => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function LeaveCalendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('timeline') // 'timeline' | 'month'
  const [deptFilter, setDeptFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [error, setError] = useState(null)

  const dim = daysInMonth(year, month)

  // ── Load approved leave that overlaps the visible month ─────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0)

    // Use explicit FK hint to avoid ambiguity with approver_id FK
    const { data, error } = await supabase
      .from('leave_requests')
      .select(`
        id, start_date, end_date, days_requested, status, user_id, leave_type_id,
        leave_types ( name, color ),
        user:users!leave_requests_user_id_fkey ( full_name, department, role )
      `)
      .eq('status', 'approved')
      .gte('end_date', ymd(monthStart))
      .lte('start_date', ymd(monthEnd))
      .order('start_date', { ascending: true })

    if (error) {
      // If the `department` column doesn't exist yet, retry without it
      if (/column .*department/i.test(error.message)) {
        const retry = await supabase
          .from('leave_requests')
          .select(`
            id, start_date, end_date, days_requested, status, user_id, leave_type_id,
            leave_types ( name, color ),
            user:users!leave_requests_user_id_fkey ( full_name, role )
          `)
          .eq('status', 'approved')
          .gte('end_date', ymd(monthStart))
          .lte('start_date', ymd(monthEnd))
          .order('start_date', { ascending: true })
        if (retry.error) setError(retry.error.message)
        else setRequests(retry.data ?? [])
      } else {
        setError(error.message)
      }
    } else {
      setRequests(data ?? [])
    }
    setLoading(false)
  }, [year, month])

  useEffect(() => { load() }, [load])

  // ── Filter options derived from current data ────────────────
  const departments = useMemo(() => {
    const set = new Set()
    requests.forEach(r => set.add(r.user?.department ?? 'Unassigned'))
    return Array.from(set).sort()
  }, [requests])

  const leaveTypes = useMemo(() => {
    const map = new Map()
    requests.forEach(r => {
      if (r.leave_type_id && r.leave_types) {
        map.set(r.leave_type_id, r.leave_types)
      }
    })
    return Array.from(map.entries()).map(([id, lt]) => ({ id, ...lt }))
  }, [requests])

  // ── Apply filters ───────────────────────────────────────────
  const filtered = useMemo(() => {
    return requests.filter(r => {
      const dept = r.user?.department ?? 'Unassigned'
      if (deptFilter !== 'all' && dept !== deptFilter) return false
      if (typeFilter !== 'all' && r.leave_type_id !== typeFilter) return false
      return true
    })
  }, [requests, deptFilter, typeFilter])

  // ── Month navigation ────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e5e7eb', padding: '1.5rem' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>Team calendar</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Approved time off across the team</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <NavBtn onClick={prevMonth}>‹</NavBtn>
          <div style={{ minWidth: 130, textAlign: 'center', fontSize: 14, fontWeight: 500 }}>
            {MONTHS[month]} {year}
          </div>
          <NavBtn onClick={nextMonth}>›</NavBtn>
          <NavBtn onClick={goToday} style={{ marginLeft: 4 }}>Today</NavBtn>
        </div>
      </div>

      {/* Filters + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Select value={deptFilter} onChange={setDeptFilter} options={[
            { value: 'all', label: 'All departments' },
            ...departments.map(d => ({ value: d, label: d })),
          ]} />
          <Select value={typeFilter} onChange={setTypeFilter} options={[
            { value: 'all', label: 'All leave types' },
            ...leaveTypes.map(lt => ({ value: lt.id, label: lt.name })),
          ]} />
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 3, background: '#f3f4f6', borderRadius: 8 }}>
          <ToggleBtn active={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</ToggleBtn>
          <ToggleBtn active={view === 'month'} onClick={() => setView('month')}>Month grid</ToggleBtn>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={emptyStyle}>Loading approved leave…</div>
      ) : error ? (
        <div style={{ ...emptyStyle, color: '#991b1b' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>No approved leave in {MONTHS[month]} {year}.</div>
      ) : view === 'timeline' ? (
        <TimelineView requests={filtered} year={year} month={month} dim={dim} />
      ) : (
        <MonthGridView requests={filtered} year={year} month={month} dim={dim} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Timeline view (rows = people grouped by dept, cols = days)
// ═══════════════════════════════════════════════════════════════

function TimelineView({ requests, year, month, dim }) {
  const today = new Date()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  // Group by department then by user
  const grouped = useMemo(() => {
    const byDept = {}
    requests.forEach(r => {
      const dept = r.user?.department ?? 'Unassigned'
      const uid = r.user_id
      if (!byDept[dept]) byDept[dept] = {}
      if (!byDept[dept][uid]) {
        byDept[dept][uid] = {
          id: uid,
          name: r.user?.full_name ?? 'Unknown',
          role: r.user?.role,
          requests: [],
        }
      }
      byDept[dept][uid].requests.push(r)
    })
    return Object.entries(byDept).map(([dept, users]) => ({
      dept,
      users: Object.values(users),
    }))
  }, [requests])

  const days = useMemo(() => Array.from({ length: dim }, (_, i) => {
    const d = new Date(year, month, i + 1)
    return { day: i + 1, weekend: isWeekend(d) }
  }), [year, month, dim])

  return (
    <div style={{ border: '0.5px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Day header */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e7eb', background: '#fafafa' }}>
        <div style={{ minWidth: 180, padding: '6px 12px', fontSize: 11, color: '#6b7280', fontWeight: 500, flexShrink: 0 }}>
          Person
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dim}, 1fr)`, flex: 1 }}>
          {days.map(d => {
            const isToday = year === today.getFullYear() && month === today.getMonth() && d.day === today.getDate()
            return (
              <div key={d.day} style={{
                fontSize: 10, textAlign: 'center', padding: '6px 0',
                color: isToday ? '#1D9E75' : d.weekend ? '#d1d5db' : '#6b7280',
                fontWeight: isToday ? 700 : 400,
                background: d.weekend ? '#f3f4f6' : undefined,
              }}>
                {d.day}
              </div>
            )
          })}
        </div>
      </div>

      {/* Dept groups */}
      {grouped.map(({ dept, users }) => (
        <Fragment key={dept}>
          <div style={{
            padding: '4px 12px', fontSize: 10, fontWeight: 600,
            color: '#9ca3af', background: '#fafafa',
            borderBottom: '0.5px solid #f3f4f6',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {dept}
          </div>
          {users.map(user => (
            <UserRow
              key={user.id}
              user={user}
              days={days}
              dim={dim}
              monthStart={monthStart}
              monthEnd={monthEnd}
            />
          ))}
        </Fragment>
      ))}
    </div>
  )
}

function UserRow({ user, days, dim, monthStart, monthEnd }) {
  return (
    <div style={{ display: 'flex', borderBottom: '0.5px solid #f3f4f6', minHeight: 44 }}>
      <div style={{
        minWidth: 180, maxWidth: 180, padding: '0 12px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user.name}
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
          {user.role && <span style={{ textTransform: 'capitalize', color: '#d1d5db' }}>· {user.role}</span>}
        </div>
      </div>
      <div style={{
        position: 'relative',
        display: 'grid', gridTemplateColumns: `repeat(${dim}, 1fr)`,
        flex: 1,
      }}>
        {days.map(d => (
          <div key={d.day} style={{
            background: d.weekend ? '#fafafa' : '#fff',
            borderLeft: '0.5px solid #f3f4f6',
            height: 44,
          }} />
        ))}
        {user.requests.map(r => {
          const start = new Date(r.start_date)
          const end = new Date(r.end_date)
          const startDay = start < monthStart ? 1 : start.getDate()
          const endDay = end > monthEnd ? dim : end.getDate()
          const left = ((startDay - 1) / dim) * 100
          const width = ((endDay - startDay + 1) / dim) * 100
          return (
            <div key={r.id} style={{
              position: 'absolute',
              left: `${left}%`,
              width: `calc(${width}% - 4px)`,
              top: 6, bottom: 6,
              background: r.leave_types?.color ?? '#9CA3AF',
              color: '#fff',
              borderRadius: 4,
              padding: '0 8px',
              fontSize: 11, fontWeight: 500,
              display: 'flex', alignItems: 'center',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              boxSizing: 'border-box',
              marginLeft: 2,
            }} title={
              `${r.leave_types?.name ?? 'Leave'}\n` +
              `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}\n` +
              `${r.days_requested} day${r.days_requested === 1 ? '' : 's'}`
            }>
              {r.leave_types?.name}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Month grid view (traditional 7-col calendar)
// ═══════════════════════════════════════════════════════════════

function MonthGridView({ requests, year, month, dim }) {
  const dayMap = useMemo(() => {
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0)
    const out = {}
    for (let d = 1; d <= dim; d++) out[d] = []
    requests.forEach(r => {
      const start = new Date(r.start_date)
      const end = new Date(r.end_date)
      const startDay = start < monthStart ? 1 : start.getDate()
      const endDay = end > monthEnd ? dim : end.getDate()
      for (let d = startDay; d <= endDay; d++) out[d].push(r)
    })
    return out
  }, [requests, year, month, dim])

  const cells = useMemo(() => {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
    const arr = []
    for (let i = 0; i < firstDow; i++) arr.push(null)
    for (let i = 1; i <= dim; i++) arr.push(i)
    while (arr.length % 7 !== 0) arr.push(null)
    return arr
  }, [year, month, dim])

  const todayStr = ymd(new Date())

  return (
    <div style={{ border: '0.5px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#fafafa', borderBottom: '0.5px solid #e5e7eb' }}>
        {DOW_LONG.map(l => (
          <div key={l} style={{ padding: '8px 10px', fontSize: 11, color: '#6b7280', fontWeight: 500 }}>
            {l}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((d, i) => {
          if (!d) return (
            <div key={i} style={{
              minHeight: 110, background: '#fafafa',
              borderRight: '0.5px solid #f3f4f6', borderBottom: '0.5px solid #f3f4f6',
            }} />
          )
          const date = new Date(year, month, d)
          const weekend = isWeekend(date)
          const isToday = ymd(date) === todayStr
          const items = dayMap[d] ?? []
          return (
            <div key={i} style={{
              minHeight: 110, padding: 6,
              background: weekend ? '#fafafa' : '#fff',
              borderRight: '0.5px solid #f3f4f6', borderBottom: '0.5px solid #f3f4f6',
              display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              <div style={{
                alignSelf: 'flex-start',
                fontSize: 11, fontWeight: 500,
                color: isToday ? '#fff' : '#374151',
                background: isToday ? '#1D9E75' : 'transparent',
                width: 20, height: 20, lineHeight: '20px',
                borderRadius: '50%', textAlign: 'center',
              }}>{d}</div>
              {items.slice(0, 3).map(r => (
                <div key={r.id} style={{
                  background: r.leave_types?.color ?? '#9CA3AF',
                  color: '#fff', fontSize: 10,
                  padding: '2px 6px', borderRadius: 3,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }} title={
                  `${r.user?.full_name}` +
                  `${r.user?.department ? ` (${r.user.department})` : ''}\n` +
                  `${r.leave_types?.name ?? 'Leave'}\n` +
                  `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`
                }>
                  {compactName(r.user?.full_name)}
                </div>
              ))}
              {items.length > 3 && (
                <div style={{ fontSize: 10, color: '#6b7280', paddingLeft: 4 }}>
                  +{items.length - 3} more
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// "Sarah Johnson" → "Sarah J." for tight day cells
function compactName(full) {
  if (!full) return '—'
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// ═══════════════════════════════════════════════════════════════
// Local UI primitives
// ═══════════════════════════════════════════════════════════════

const emptyStyle = {
  padding: '3rem 1rem', textAlign: 'center',
  color: '#9ca3af', fontSize: 13,
  border: '0.5px dashed #e5e7eb', borderRadius: 8,
}

function NavBtn({ children, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 13, padding: '0.35rem 0.7rem',
      border: '0.5px solid #d1d5db', background: '#fff',
      borderRadius: 8, cursor: 'pointer',
      fontFamily: 'inherit', color: '#374151',
      ...style,
    }}>{children}</button>
  )
}

function ToggleBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '0.3rem 0.7rem',
      border: 'none',
      background: active ? '#fff' : 'transparent',
      borderRadius: 6,
      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      cursor: 'pointer', fontFamily: 'inherit',
      color: active ? '#111' : '#6b7280',
      fontWeight: active ? 500 : 400,
    }}>{children}</button>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      fontSize: 12, padding: '0.4rem 0.65rem',
      border: '0.5px solid #d1d5db', borderRadius: 8,
      background: '#fff', color: '#374151',
      fontFamily: 'inherit', cursor: 'pointer',
    }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
