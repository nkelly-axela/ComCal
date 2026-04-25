/**
 * src/hooks/useAuth.js
 * ─────────────────────────────────────────────────────────────
 * Hook that exposes the current Supabase session, the matching
 * profile row from public.users (including role + department),
 * and a signOut helper. Re-runs the profile fetch whenever the
 * session changes.
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadProfile(uid) {
      // Try selecting the optional `department` column. If it doesn't
      // exist yet (pre migration_04), fall back without it so login
      // still works.
      let { data, error } = await supabase
        .from('users')
        .select('id, full_name, role, department')
        .eq('id', uid)
        .maybeSingle()

      if (error && /column .*department/i.test(error.message)) {
        const retry = await supabase
          .from('users')
          .select('id, full_name, role')
          .eq('id', uid)
          .maybeSingle()
        data = retry.data
        error = retry.error
      }

      if (cancelled) return
      if (error) {
        console.error('Failed to load user profile:', error)
        setProfile(null)
      } else {
        setProfile(data ?? null)
      }
    }

    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      const u = session?.user ?? null
      setUser(u)
      if (u) await loadProfile(u.id)
      if (!cancelled) setLoading(false)
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const u = session?.user ?? null
        setUser(u)
        if (u) {
          await loadProfile(u.id)
        } else {
          setProfile(null)
        }
      }
    )

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return {
    user,
    profile,
    loading,
    signOut: () => supabase.auth.signOut(),
  }
}
