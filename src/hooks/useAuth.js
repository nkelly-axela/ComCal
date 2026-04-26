/**
 * src/hooks/useAuth.js
 * ─────────────────────────────────────────────────────────────
 * Hook that exposes the current Supabase session, the matching
 * profile row from public.users (including role + department),
 * and a signOut helper. Re-runs the profile fetch whenever the
 * session changes.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Defined outside the hook so it never gets recreated and never
// closes over stale refs.
async function fetchProfile(uid) {
  // Explicitly select only scalar columns. manager_id is a FK so
  // PostgREST will try to embed it as a relation — omitting it here
  // avoids a silent null return that causes "Account not linked".
  let { data, error } = await supabase
    .from('users')
    .select('id, full_name, role, department, company')
    .eq('id', uid)
    .maybeSingle()

  // Fallback if department/company columns don't exist yet
  if (error && /column .*(department|company)/i.test(error.message)) {
    const retry = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('id', uid)
      .maybeSingle()
    data = retry.data
    error = retry.error
  }

  if (error) {
    console.error('Failed to load user profile:', error)
    return null
  }
  return data ?? null
}

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Use a ref to track the current "session ID" so that a slow
  // in-flight loadProfile from a previous auth event doesn't
  // overwrite state set by a newer event.
  const activeSessionRef = useRef(0)

  useEffect(() => {
    let timeoutId

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Give this event a unique session ID
        const sessionId = ++activeSessionRef.current

        // Handle expired/invalid token — sign out cleanly
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !session) {
          if (sessionId === activeSessionRef.current) {
            setUser(null)
            setProfile(null)
            setLoading(false)
          }
          return
        }

        if (event === 'SIGNED_OUT') {
          if (sessionId === activeSessionRef.current) {
            setUser(null)
            setProfile(null)
            setLoading(false)
          }
          return
        }

        const u = session?.user ?? null

        if (sessionId === activeSessionRef.current) {
          setUser(u)
        }

        if (u) {
          const prof = await fetchProfile(u.id)
          // Only apply if this is still the latest event
          if (sessionId === activeSessionRef.current) {
            setProfile(prof)
            setLoading(false)
          }
        } else {
          if (sessionId === activeSessionRef.current) {
            setProfile(null)
            setLoading(false)
          }
        }
      }
    )

    // Safety net: stop spinner after 6s if no event fires
    timeoutId = setTimeout(() => {
      if (activeSessionRef.current === 0) {
        setLoading(false)
      }
    }, 6000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeoutId)
    }
  }, [])

  const signOut = useCallback(async () => {
    // Immediately clear state so UI responds even if the
    // Supabase signOut call fails due to an expired token
    activeSessionRef.current++
    setUser(null)
    setProfile(null)
    setLoading(false)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      // Ignore errors — state is already cleared above
      console.warn('signOut error (ignored):', e)
    }
  }, [])

  return { user, profile, loading, signOut }
}

