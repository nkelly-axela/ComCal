/**
 * src/hooks/useAuth.js
 * ─────────────────────────────────────────────────────────────
 * Hook that exposes the current Supabase session, the matching
 * profile row from public.users (including role + department),
 * and a signOut helper. Re-runs the profile fetch whenever the
 * session changes.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const cancelledRef = useRef(false)

  async function loadProfile(uid) {
    let { data, error } = await supabase
      .from('users')
      .select('id, full_name, role, department')
      .eq('id', uid)
      .maybeSingle()

    // Fallback if department column doesn't exist yet
    if (error && /column .*department/i.test(error.message)) {
      const retry = await supabase
        .from('users')
        .select('id, full_name, role')
        .eq('id', uid)
        .maybeSingle()
      data = retry.data
      error = retry.error
    }

    if (cancelledRef.current) return
    if (error) {
      console.error('Failed to load user profile:', error)
      setProfile(null)
    } else {
      setProfile(data ?? null)
    }
  }

  useEffect(() => {
    cancelledRef.current = false

    // ── Initial session check ────────────────────────────────
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelledRef.current) return
      const u = session?.user ?? null
      setUser(u)
      if (u) await loadProfile(u.id)
      setLoading(false)
    })

    // ── Auth state listener ──────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelledRef.current) return

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        const u = session?.user ?? null
        setUser(u)
        if (u) {
          await loadProfile(u.id)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => {
      cancelledRef.current = true
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    // onAuthStateChange will fire SIGNED_OUT and clear state
  }

  return { user, profile, loading, signOut }
}
