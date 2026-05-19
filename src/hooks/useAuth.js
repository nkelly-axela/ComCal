/**
 * src/hooks/useAuth.js
 * Rewritten to avoid ALL race conditions with Supabase auth lock.
 * Uses a single getSession() call with no competing listeners on mount.
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

async function fetchProfile(uid) {
  // Run as authenticated user — session must be set before calling this
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, role, department, company')
    .eq('id', uid)
    .maybeSingle()

  if (error) {
    console.error('fetchProfile error:', error.message)
    return null
  }
  return data ?? null
}

export function useAuth() {
  const [user,    setUser]    = useState(undefined) // undefined = not yet checked
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function init() {
      try {
        // Step 1: Get session — reads from localStorage, no network needed
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!active) return

        if (!session?.user) {
          setUser(null)
          setLoading(false)
          return
        }

        setUser(session.user)

        // Step 2: Fetch profile row
        const prof = await fetchProfile(session.user.id)
        if (!active) return
        setProfile(prof)
        setLoading(false)

      } catch (err) {
        console.error('useAuth init error:', err.message)
        if (active) {
          setUser(null)
          setProfile(null)
          setLoading(false)
        }
      }
    }

    init()

    // Step 3: Listen for SIGNED_IN / SIGNED_OUT only — skip INITIAL_SESSION
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') return
        if (!active) return

        if (event === 'SIGNED_OUT' || !session?.user) {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setUser(session.user)
          const prof = await fetchProfile(session.user.id)
          if (active) {
            setProfile(prof)
            setLoading(false)
          }
        }
      }
    )

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    setUser(null)
    setProfile(null)
    setLoading(false)
    await supabase.auth.signOut().catch(() => {})
  }, [])

  return { user, profile, loading, signOut }
}
