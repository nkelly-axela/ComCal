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
    const { data, error } = await supabase
      .from('leave_requests')
      .select(`
        id, start_date, end_date, days_requested, status, user_id, leave_type_id,
        leave_types ( name, color ),
        users ( full_name, department, role )
      `)
      .eq('status', 'approved')
      .gte('end_date', ymd(monthStart))
      .lte('start_date', ymd(monthEnd))
      .order('start_date', { ascending: true })

    if (error) {
      // If the `department` column doesn't exist yet, retry without it
      // so the calendar still works in a partial schema.
      if (/column .*department/i.test(error.message)) {
        const retry = await supabase
          .from('leave_requests')
          .select(`
            id, start_date, end_date, days_requested, status, user_id, leave_type_id,
            leave_types ( name, color ),
            users ( full_name, role )
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
    requests.forEach(r => set.add(r.users?.department ?? 'Unassigned'))
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
      const dept = r.users?.department ?? 'Unassigned'
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
  // Group by department then by user
  const grouped = useMemo(() => {
    const byDept = {}
    requests.forEach(r => {
      const dept = r.users?.department ?? 'Unassigned'
      const uid = r.user_id
      if (!byDept[dept]) byDept[dept] = {}
      if (!byDept[dept][uid]) {
        byDept[dept][uid] = {
          id: uid,
          name: r.users?.full_name ?? 'Unknown',
          role: r.users?.role,
          dept,
          requests: [],
        }
      }
      byDept[dept][uid].requests.push(r)
    })
    return Object.entries(byDept)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dept, users]) => ({
        dept,
        users: Object.values(users).sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [requests])

  // Day metadata (label, weekend flag, today flag)
  const days = useMemo(() => {
    const out = []
    const todayStr = ymd(new Date())
    for (let i = 1; i <= dim; i++) {
      const d = new Date(year, month, i)
      out.push({
        day: i,
        label: DOW_SHORT[(d.getDay() + 6) % 7], // Mon = 0
        weekend: isWeekend(d),
        isToday: ymd(d) === todayStr,
      })
    }
    return out
  }, [year, month, dim])

  const NAME_COL = 220
  const dayMinWidth = 28

  return (
    <div style={{ overflowX: 'auto', border: '0.5px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ minWidth: NAME_COL + dim * dayMinWidth }}>

        {/* Day header row */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e7eb' }}>
          <div style={{
            width: NAME_COL, flexShrink: 0,
            padding: '8px 12px', background: '#fafafa',
            fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>Team</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dim}, 1fr)`, flex: 1 }}>
            {days.map(d => (
              <div key={d.day} style={{
                textAlign: 'center', padding: '4px 0',
                background: d.weekend ? '#f3f4f6' : '#fafafa',
                borderLeft: '0.5px solid #e5e7eb',
              }}>
                <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase' }}>{d.label}</div>
                <div style={{
                  fontSize: 12, fontWeight: 500,
                  color: d.isToday ? '#fff' : '#374151',
                  background: d.isToday ? '#1D9E75' : 'transparent',
                  width: 18, height: 18, lineHeight: '18px',
                  borderRadius: '50%', display: 'inline-block',
                }}>{d.day}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Department + user rows */}
        {grouped.map(({ dept, users }) => (
          <Fragment key={dept}>
            <div style={{
              padding: '6px 12px',
              background: '#f9fafb',
              fontSize: 11, fontWeight: 600, color: '#6b7280',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderTop: '0.5px solid #e5e7eb',
              borderBottom: '0.5px solid #e5e7eb',
            }}>
              {dept} <span style={{ color: '#9ca3af', fontWeight: 400 }}>· {users.length}</span>
            </div>
            {users.map(u => (
              <UserRow key={u.id}
                user={u} days={days} dim={dim}
                year={year} month={month}
                nameColWidth={NAME_COL}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function UserRow({ user, days, dim, year, month, nameColWidth }) {
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  return (
    <div style={{ display: 'flex', borderTop: '0.5px solid #f3f4f6' }}>
      <div style={{
        width: nameColWidth, flexShrink: 0,
        padding: '8px 12px', background: '#fff',
      }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{user.name}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', display: 'flex', gap: 6 }}>
          <span>{user.dept}</span>
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
  // Map: day-of-month → list of requests covering that day
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

  // Build cell list (Mon-first, with leading/trailing blanks to fill weeks)
  const cells = useMemo(() => {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // Mon = 0
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
                  `${r.users?.full_name}` +
                  `${r.users?.department ? ` (${r.users.department})` : ''}\n` +
                  `${r.leave_types?.name ?? 'Leave'}\n` +
                  `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`
                }>
                  {compactName(r.users?.full_name)}
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
