import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AUTH_TIMEOUT_MS = 5000

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

function withTimeout(promise, ms, label) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

export function useAuth() {
  const [user,    setUser]    = useState(undefined) // undefined = not yet checked
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const profileRequestRef = useRef(0)

  const loadProfile = useCallback(async (uid) => {
    const requestId = ++profileRequestRef.current

    try {
      const prof = await withTimeout(fetchProfile(uid), AUTH_TIMEOUT_MS, 'fetchProfile')
      if (requestId !== profileRequestRef.current) return

      setProfile(prof)
    } catch (err) {
      if (requestId !== profileRequestRef.current) return
      console.error('[useAuth] fetchProfile failed:', err.message)
      setProfile(null)
    } finally {
      if (requestId === profileRequestRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    async function init() {
      try {
        // Step 1: Get session — reads from localStorage, no network needed
        const { data: { session }, error } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          'getSession'
        )
        if (error) throw error
        if (!active) return

        if (!session?.user) {
          setUser(null)
          setLoading(false)
          return
        }

        setUser(session.user)
        setTimeout(() => {
          if (active) loadProfile(session.user.id)
        }, 0)

      } catch (err) {
        console.error('useAuth init error:', err.message)
        if (active) {
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
          profileRequestRef.current++
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setUser(session.user)
          setTimeout(() => {
            if (active) loadProfile(session.user.id)
          }, 0)
        }
      }
    )

    return () => {
      active = false
      profileRequestRef.current++
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    profileRequestRef.current++
    setUser(null)
    setProfile(null)
    setLoading(false)
    await supabase.auth.signOut().catch(() => {})
  }, [])

  return { user, profile, loading, signOut }
}
