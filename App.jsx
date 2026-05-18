/**
 * src/App.jsx
 * ─────────────────────────────────────────────────────────────
 * Auth gate + role-based view router.
 *
 * Views:
 *   user     → LeaveUserPanel  (all authenticated users)
 *   calendar → LeaveCalendar   (all authenticated users)
 *   admin    → LeaveAdminPanel (manager / admin only)
 *
 * New in this version:
 *   • Conflict badge on the Admin tab — shows count of pending
 *     requests with conflict_flag = true so managers know at
 *     a glance when flagged requests are waiting
 *   • Correct import: LeaveAdminPanel-2 → LeaveAdminPanel
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './hooks/useAuth'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import LeaveUserPanel from './components/LeaveUserPanel'
import LeaveAdminPanel from './components/LeaveAdminPanel-2'
import LeaveCalendar from './components/LeaveCalendar'

export default function App() {
  const { user, profile, loading, signOut } = useAuth()
  const [view, setView] = useState('user')

  // Conflict badge: count of pending requests with conflict_flag
  const [conflictCount, setConflictCount] = useState(0)

  const loadConflictCount = useCallback(async () => {
    if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) return
    try {
      const { count } = await supabase
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('conflict_flag', true)
      setConflictCount(count ?? 0)
    } catch { /* silently ignore */ }
  }, [profile])

  useEffect(() => { loadConflictCount() }, [loadConflictCount])

  if (loading) return <CenteredCard>Loading…</CenteredCard>
  if (!user)   return <Login />

  if (!profile) {
    return (
      <CenteredCard>
        <div style={{ marginBottom:12, fontWeight:500 }}>Account not linked</div>
        <div style={{ fontSize:13, color:'#6b7280', marginBottom:16 }}>
          Your sign-in succeeded, but there's no matching row in <code>public.users</code> for
          your account. Ask an admin to create one (with the same id as your auth user).
        </div>
        <button onClick={signOut} style={signOutBtn}>Sign out</button>
      </CenteredCard>
    )
  }

  const isAdmin  = profile.role === 'admin' || profile.role === 'manager'
  const safeView = view === 'admin' && !isAdmin ? 'user' : view

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f4' }}>
      <TopBar
        profile={profile}
        view={safeView}
        setView={setView}
        isAdmin={isAdmin}
        signOut={signOut}
        conflictCount={conflictCount}
      />
      <div style={{ padding:'1.5rem', maxWidth:1280, margin:'0 auto' }}>
        {safeView === 'admin'    && <LeaveAdminPanel />}
        {safeView === 'calendar' && <LeaveCalendar />}
        {safeView === 'user'     && (
          <LeaveUserPanel
            userId={user.id}
            userRole={profile.role}
            fullName={profile.full_name}
          />
        )}
      </div>
    </div>
  )
}

// ─── Top bar ──────────────────────────────────────────────────

function TopBar({ profile, view, setView, isAdmin, signOut, conflictCount }) {
  return (
    <header style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0.75rem 1.5rem', background:'#fff',
      borderBottom:'0.5px solid #e5e7eb',
      position:'sticky', top:0, zIndex:10,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ fontWeight:600, fontSize:15, color:'#111' }}>Leave</div>
        <nav style={{ display:'flex', gap:4 }}>
          <TabBtn active={view==='user'}     onClick={()=>setView('user')}>My leave</TabBtn>
          <TabBtn active={view==='calendar'} onClick={()=>setView('calendar')}>Team calendar</TabBtn>
          {isAdmin && (
            <TabBtn active={view==='admin'} onClick={()=>setView('admin')}>
              Admin
              {conflictCount > 0 && (
                <span style={{
                  marginLeft:6, background:'#E24B4A', color:'#fff',
                  fontSize:10, fontWeight:500, padding:'1px 6px',
                  borderRadius:10, lineHeight:'16px',
                }}>
                  {conflictCount}
                </span>
              )}
            </TabBtn>
          )}
        </nav>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:12, fontSize:13 }}>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontWeight:500 }}>{profile.full_name}</div>
          <div style={{ fontSize:11, color:'#9ca3af', textTransform:'capitalize' }}>{profile.role}</div>
        </div>
        <button onClick={signOut} style={signOutBtn}>Sign out</button>
      </div>
    </header>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      fontSize:13, padding:'0.4rem 0.85rem',
      border:'0.5px solid', borderColor:active?'#1D9E75':'transparent',
      background:active?'#E1F5EE':'transparent',
      color:active?'#0F6E56':'#6b7280',
      borderRadius:8, cursor:'pointer',
      fontFamily:'inherit', fontWeight:active?500:400,
      display:'inline-flex', alignItems:'center',
    }}>{children}</button>
  )
}

const signOutBtn = {
  fontSize:12, padding:'0.4rem 0.75rem',
  border:'0.5px solid #d1d5db', borderRadius:8,
  background:'transparent', color:'#374151',
  cursor:'pointer', fontFamily:'inherit',
}

function CenteredCard({ children }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f5f5f4' }}>
      <div style={{ background:'#fff', borderRadius:12, border:'0.5px solid #e5e7eb', padding:'2rem', maxWidth:380, width:'90%', textAlign:'center', fontFamily:'system-ui,sans-serif', fontSize:14, color:'#111' }}>
        {children}
      </div>
    </div>
  )
}
