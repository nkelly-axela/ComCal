/**
 * src/hooks/useAuth.js
 * ─────────────────────────────────────────────────────────────
 * Hook that exposes the current Supabase session, the matching
 * profile row from public.users (including role + department),
 * and a signOut helper.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Defined outside the hook — stable, never recreated, no stale closures
async function fetchProfile(uid) {
  let { data, error } = await supabase
    .from('users')
    .select('id, full_name, role, department, company')
    .eq('id', uid)
    .maybeSingle()

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
  const activeSessionRef = useRef(0)
  const resolvedRef = useRef(false)

  useEffect(() => {
    let timeoutId

    const resolve = (sessionId, u, prof) => {
      if (sessionId !== activeSessionRef.current) return
      resolvedRef.current = true
      setUser(u)
      setProfile(prof)
      setLoading(false)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const sessionId = ++activeSessionRef.current

        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
          resolve(sessionId, null, null)
          return
        }

        const u = session?.user ?? null

        if (!u) {
          resolve(sessionId, null, null)
          return
        }

        // Set user immediately so UI is responsive
        if (sessionId === activeSessionRef.current) {
          setUser(u)
        }

        const prof = await fetchProfile(u.id)
        resolve(sessionId, u, prof)
      }
    )

    // Safety net: if nothing resolves within 8s, unblock the UI
    timeoutId = setTimeout(() => {
      if (!resolvedRef.current) {
        console.warn('useAuth: timeout — forcing loading=false')
        setLoading(false)
      }
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeoutId)
    }
  }, [])

  const signOut = useCallback(async () => {
    // Immediately clear state — don't wait for Supabase
    activeSessionRef.current++
    resolvedRef.current = true
    setUser(null)
    setProfile(null)
    setLoading(false)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.warn('signOut error (ignored):', e)
    }
  }, [])

  return { user, profile, loading, signOut }
}

