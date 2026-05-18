/**
 * src/hooks/useAuth.js
 * ─────────────────────────────────────────────────────────────
 * Hook that exposes the current Supabase session, the matching
 * profile row from public.users, and a signOut helper.
 *
 * LOADING FIX:
 *   The previous version relied solely on onAuthStateChange,
 *   which only fires after Supabase emits an event. On a cold
 *   page load this could take several seconds, leaving the user
 *   staring at "Loading…" the whole time.
 *
 *   Fix: call supabase.auth.getSession() immediately on mount.
 *   This resolves synchronously from the local token store in
 *   almost all cases — typically < 50ms. onAuthStateChange is
 *   kept alongside it to handle token refreshes, sign-in, and
 *   sign-out events that happen after initial load.
 *
 *   The result: the app unblocks as fast as a local read, with
 *   no visible loading screen for users who are already logged in.
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

  // Graceful fallback if department/company columns don't exist yet
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
    console.error('fetchProfile error:', error)
    return null
  }
  return data ?? null
}

export function useAuth() {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Guards against race conditions when multiple events fire quickly
  const activeRef   = useRef(0)
  const resolvedRef = useRef(false)

  const resolve = useCallback((sessionId, u, prof) => {
    if (sessionId !== activeRef.current) return
    resolvedRef.current = true
    setUser(u)
    setProfile(prof)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    // ── Step 1: Check for an existing session immediately ─────
    // getSession() reads from localStorage/cookie — no network
    // round-trip needed. This is what eliminates the loading screen
    // for users who are already logged in.
    const bootstrap = async () => {
      const sessionId = ++activeRef.current

      try {
        const { data: { session }, error } = await supabase.auth.getSession()

        if (cancelled) return
        if (error) {
          console.warn('getSession error:', error)
          resolve(sessionId, null, null)
          return
        }

        const u = session?.user ?? null

        if (!u) {
          // No session — show login immediately, don't wait
          resolve(sessionId, null, null)
          return
        }

        // We have a user — set it now so the UI can start rendering
        if (!cancelled && sessionId === activeRef.current) {
          setUser(u)
        }

        // Fetch profile row (one Supabase query)
        const prof = await fetchProfile(u.id)
        if (!cancelled) resolve(sessionId, u, prof)

      } catch (e) {
        console.error('bootstrap error:', e)
        if (!cancelled) resolve(activeRef.current, null, null)
      }
    }

    bootstrap()

    // ── Step 2: Listen for subsequent auth events ─────────────
    // Handles sign-in, sign-out, token refresh after bootstrap.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Ignore the INITIAL_SESSION event — bootstrap already handled it
        // (avoids a duplicate profile fetch on load)
        if (event === 'INITIAL_SESSION') return

        const sessionId = ++activeRef.current

        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
          resolve(sessionId, null, null)
          return
        }

        const u = session?.user ?? null
        if (!u) { resolve(sessionId, null, null); return }

        if (sessionId === activeRef.current) setUser(u)

        const prof = await fetchProfile(u.id)
        resolve(sessionId, u, prof)
      }
    )

    // ── Safety net: 5s timeout (down from 8s) ─────────────────
    // Should never be needed given bootstrap(), but keeps the app
    // from hanging if something goes wrong with Supabase client init.
    const timeoutId = setTimeout(() => {
      if (!resolvedRef.current) {
        console.warn('useAuth: 5s timeout — forcing loading=false')
        setLoading(false)
      }
    }, 5000)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      clearTimeout(timeoutId)
    }
  }, [resolve])

  const signOut = useCallback(async () => {
    // Clear state immediately — don't wait for the Supabase call
    activeRef.current++
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
