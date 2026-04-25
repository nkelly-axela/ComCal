/**
 * src/lib/supabase.js
 * ─────────────────────────────────────────────────────────────
 * Single shared Supabase browser client.
 *
 * Env vars expected (Vite):
 *   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJhbGc...
 *
 * On Vercel: add both vars under
 *   Project → Settings → Environment Variables
 * for Production, Preview and Development, then redeploy.
 * The anon key is safe to expose to the browser — RLS is what
 * protects your data.
 * ─────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
    'in .env.local (locally) or in Vercel Project Settings (deployed).'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
