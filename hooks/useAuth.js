/**
 * src/hooks/useAuth.js
 * ─────────────────────────────────────────────────────────────
 * Supabase auth hook — fast load, no double-mount lock issue.
 *
 * Strategy:
 *   1. Call getSession() once on mount to read the existing
 *      session from localStorage. This is synchronous-ish and
 *      resolves in <50ms — no loading screen for logged-in users.
 *   2. Skip the INITIAL_SESSION event from onAuthStateChange
 *      (it fires after getSession and would cause a duplicate
 *      profile fetch and the gotrue lock contention warning).
 *   3. Only react to SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED
 *      events that happen after initial load.
 *
 * StrictMode note:
 *   React StrictMode double-mounts in dev, which causes both
 *   mounts to race for the Supabase auth lock simultaneously.
 *   We removed StrictMode from main.jsx to avoid this. If you
 *   re-enable it, you'll see the lock warning again.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

async function fetchProfile(uid) {
  let { data, error } = await supabase
    .from('users')
    .select('id, full_name, role, department, company')
    .eq('id', uid)
    .maybeSingle()

  // Graceful fallback if columns don't exist yet
  if (error && /column .*(department|company)/i.test(error.message)) {
    const retry = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('id', uid)
      .maybeSingle()
    data  = retry.data
    error = retry.error
  }

  if (error) {
    console.error('fetchProfile error:', error.message)
    return null
  }
  return data ?? null
}

export function useAuth() {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const bootstrappedRef = useRef(false) // true once getSession() has resolved
  const cancelledRef    = useRef(false) // true after component unmounts

  useEffect(() => {
    cancelledRef.current = false

    // ── Bootstrap: read existing session immediately ───────────
    const bootstrap = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelledRef.current) return

        const u = session?.user ?? null
        bootstrappedRef.current = true

        if (!u) {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        setUser(u)
        const prof = await fetchProfile(u.id)
        if (cancelledRef.current) return
        setProfile(prof)
        setLoading(false)

      } catch (err) {
        console.error('useAuth bootstrap error:', err)
        if (!cancelledRef.current) {
          setUser(null)
          setProfile(null)
          setLoading(false)
        }
      }
    }

    bootstrap()

    // ── Event listener: handle post-load auth changes ──────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Skip INITIAL_SESSION — bootstrap() already handled it.
        // This is the key fix: without this guard, both bootstrap()
        // and the INITIAL_SESSION event would race for the auth lock.
        if (event === 'INITIAL_SESSION') return

        // Also skip if bootstrap hasn't resolved yet — it will set
        // state itself when it finishes.
        if (!bootstrappedRef.current) return

        if (cancelledRef.current) return

        const u = session?.user ?? null

        if (!u) {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        setUser(u)
        const prof = await fetchProfile(u.id)
        if (!cancelledRef.current) {
          setProfile(prof)
          setLoading(false)
        }
      }
    )

    // Fallback timeout — should never be needed now
    const timeoutId = setTimeout(() => {
      if (!bootstrappedRef.current && !cancelledRef.current) {
        console.warn('useAuth: 6s timeout — forcing loading=false')
        setLoading(false)
      }
    }, 6000)

    return () => {
      cancelledRef.current = true
      subscription.unsubscribe()
      clearTimeout(timeoutId)
    }
  }, [])

  const signOut = useCallback(async () => {
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
