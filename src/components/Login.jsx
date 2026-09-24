/**
 * src/components/Login.jsx
 * ─────────────────────────────────────────────────────────────
 * Email + password sign-in screen using Supabase Auth.
 *
 * Behaviour:
 *   - Sign in with existing credentials.
 *   - "Forgot password?" and "Have an invite code?" hand off to
 *     ResetPassword.jsx (via App.jsx), where the user enters the
 *     6-digit code from their email and chooses a new password.
 *
 * Note on accounts: this screen does NOT include a sign-up form.
 * The expectation is that admins create users either through the
 * Supabase dashboard (Authentication → Users → Invite) or via a
 * server-side admin script. The matching row in public.users
 * must share the same id as auth.users.id.
 * ─────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login({ onResetPassword }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const onSignIn = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      // useAuth in App.jsx will pick up the session via onAuthStateChange.
    } catch (err) {
      setError(err.message ?? 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={shell}>
      <form onSubmit={onSignIn} style={card}>
        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Leave Management</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Sign in to continue</div>
        </div>

        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            required
            style={inputStyle}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            style={inputStyle}
          />
        </Field>

        {error && (
          <div style={alertStyle('error')}>{error}</div>
        )}

        <button type="submit" disabled={busy} style={primaryBtn(busy)}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => onResetPassword('recovery', email)}
          disabled={busy}
          style={linkBtn}
        >
          Forgot password?
        </button>

        <button
          type="button"
          onClick={() => onResetPassword('invite', email)}
          disabled={busy}
          style={{ ...linkBtn, marginTop: 0, color: '#6b7280' }}
        >
          Have an invite code?
        </button>

        <div style={{
          marginTop: '1.25rem', paddingTop: '1rem',
          borderTop: '0.5px solid #e5e7eb',
          fontSize: 11, color: '#9ca3af', textAlign: 'center',
        }}>
          Don't have an account? Ask your admin to add you.
        </div>
      </form>
    </div>
  )
}

// ─── Styles (shared with ResetPassword.jsx) ──────────────────
export const shell = {
  minHeight: '100vh',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#f5f5f4',
  fontFamily: 'system-ui, sans-serif', color: '#111',
  padding: '1rem',
}

export const card = {
  background: '#fff', borderRadius: 12,
  border: '0.5px solid #e5e7eb', padding: '2rem',
  width: 360, maxWidth: '100%',
  boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
}

export const inputStyle = {
  width: '100%', fontSize: 13, padding: '0.55rem 0.7rem',
  border: '0.5px solid #d1d5db', borderRadius: 8,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

export const Field = ({ label, children }) => (
  <div style={{ marginBottom: '0.85rem' }}>
    <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</label>
    {children}
  </div>
)

export const alertStyle = (type) => ({
  padding: '0.55rem 0.75rem',
  borderRadius: 8,
  fontSize: 12,
  marginBottom: '0.75rem',
  background: type === 'error' ? '#fee2e2' : '#dbeafe',
  color: type === 'error' ? '#991b1b' : '#1e40af',
  border: `0.5px solid ${type === 'error' ? '#fca5a5' : '#93c5fd'}`,
})

export const primaryBtn = (busy) => ({
  width: '100%', padding: '0.6rem',
  background: '#1D9E75', color: '#fff',
  border: '0.5px solid #1D9E75', borderRadius: 8,
  fontSize: 13, fontWeight: 500,
  cursor: busy ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
  marginTop: '0.25rem',
})

export const linkBtn = {
  width: '100%', padding: '0.5rem 0',
  background: 'transparent', border: 'none',
  color: '#1D9E75', fontSize: 12,
  cursor: 'pointer', fontFamily: 'inherit',
  marginTop: '0.5rem',
}
