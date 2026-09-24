/**
 * src/components/ResetPassword.jsx
 * ─────────────────────────────────────────────────────────────
 * Choose a new password using a 6-digit code sent by email.
 *
 * Two modes:
 *   - 'recovery' (Login → "Forgot password?"): the user enters their
 *     email, we send a code via resetPasswordForEmail, then they enter
 *     the code plus a new password.
 *   - 'invite' (Login → "Have an invite code?"): for new starters added
 *     in Admin → Add user, which emails a code via signInWithOtp. We skip
 *     straight to entering email + code + password.
 *
 * Codes, not links: email scanners (Outlook Safe Links) open links
 * before the user does and burn the one-time token. A code in the
 * email body can't be spent that way, and works across devices.
 *
 * Supabase setup (see README): Email OTP Length = 6, and the Reset
 * Password, Magic Link and Confirm signup templates must show
 * {{ .Token }}.
 *
 * Rendered by App.jsx above the auth gate, because verifyOtp signs
 * the user in — we must stay on this screen until the new password
 * is saved.
 * ─────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  shell, card, inputStyle, Field, alertStyle, primaryBtn, linkBtn,
} from './Login'

const CODE_LENGTH = 6
const MIN_PASSWORD_LENGTH = 8

export default function ResetPassword({ mode, initialEmail = '', onDone, onCancel }) {
  const [step,     setStep]     = useState(mode === 'invite' ? 'code' : 'email')
  const [email,    setEmail]    = useState(initialEmail)
  const [code,     setCode]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [verified, setVerified] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)
  const [info,     setInfo]     = useState(null)

  const isInvite = mode === 'invite'

  const sendCode = async () => {
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      // New starters get a fresh invite code; shouldCreateUser: false means
      // this can't be used to create accounts the admin didn't add.
      const { error } = isInvite
        ? await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { shouldCreateUser: false },
          })
        : await supabase.auth.resetPasswordForEmail(email.trim())
      if (error) throw error
      setStep('code')
      setCode('')
      setInfo(`If ${email.trim()} has an account, we've emailed a ${CODE_LENGTH}-digit code. It may take a minute to arrive.`)
    } catch (err) {
      setError(err.message ?? 'Could not send code')
    } finally {
      setBusy(false)
    }
  }

  const onSendCode = (e) => {
    e.preventDefault()
    sendCode()
  }

  const onSavePassword = async (e) => {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (!verified && code.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from your email.`)
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    try {
      // Verify once; if updateUser then fails (e.g. weak password) the user
      // can retry without needing a new code.
      if (!verified) {
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code,
          // Admin → Add user sends its code via signInWithOtp, which
          // verifies as type 'email'.
          type: isInvite ? 'email' : 'recovery',
        })
        if (error) throw error
        setVerified(true)
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setStep('done')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  // Verifying the code signs the user in. If they back out before saving a
  // new password, sign them out so they don't end up in the app without one.
  const cancel = async () => {
    if (verified) await supabase.auth.signOut().catch(() => {})
    onCancel()
  }

  if (step === 'done') {
    return (
      <div style={shell}>
        <div style={card}>
          <Header
            title="Password saved"
            subtitle="You're signed in with your new password."
          />
          <button type="button" onClick={onDone} style={primaryBtn(false)}>
            Continue
          </button>
        </div>
      </div>
    )
  }

  if (step === 'email') {
    return (
      <div style={shell}>
        <form onSubmit={onSendCode} style={card}>
          <Header
            title="Reset your password"
            subtitle={`We'll email you a ${CODE_LENGTH}-digit code.`}
          />

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
              autoFocus
              style={inputStyle}
            />
          </Field>

          {error && <div style={alertStyle('error')}>{error}</div>}

          <button type="submit" disabled={busy} style={primaryBtn(busy)}>
            {busy ? 'Sending…' : 'Send code'}
          </button>

          <button type="button" onClick={cancel} disabled={busy} style={linkBtn}>
            Back to sign in
          </button>
        </form>
      </div>
    )
  }

  // step === 'code'
  return (
    <div style={shell}>
      <form onSubmit={onSavePassword} style={card}>
        <Header
          title={isInvite ? 'Set up your account' : 'Choose a new password'}
          subtitle={isInvite
            ? `Enter the ${CODE_LENGTH}-digit code from your invite email.`
            : `Enter the code we sent to ${email.trim()}.`}
        />

        {isInvite ? (
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              required
              disabled={verified}
              style={inputStyle}
            />
          </Field>
        ) : (
          // Lets password managers associate the new password with the account.
          <input type="email" value={email} autoComplete="username" readOnly hidden />
        )}

        {!verified && (
          <Field label={`${CODE_LENGTH}-digit code`}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder={'0'.repeat(CODE_LENGTH)}
              required
              autoFocus={!isInvite || !!email}
              style={{ ...inputStyle, fontSize: 18, letterSpacing: '0.4em', textAlign: 'center' }}
            />
          </Field>
        )}

        <Field label="New password">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            style={inputStyle}
          />
        </Field>

        <Field label="Confirm new password">
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            style={inputStyle}
          />
        </Field>

        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: '0.75rem' }}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </div>

        {error && <div style={alertStyle('error')}>{error}</div>}
        {info  && <div style={alertStyle('info')}>{info}</div>}

        <button type="submit" disabled={busy} style={primaryBtn(busy)}>
          {busy ? 'Saving…' : 'Save password'}
        </button>

        {!verified && (
          <button
            type="button"
            onClick={sendCode}
            disabled={busy || !email.trim()}
            style={linkBtn}
          >
            {isInvite ? 'Code expired? Send a new one' : 'Resend code'}
          </button>
        )}

        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          style={{ ...linkBtn, marginTop: 0, color: '#6b7280' }}
        >
          Back to sign in
        </button>
      </form>
    </div>
  )
}

function Header({ title, subtitle }) {
  return (
    <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#6b7280' }}>{subtitle}</div>
    </div>
  )
}

function friendlyError(err) {
  const msg = err?.message ?? ''
  if (/expired|invalid/i.test(msg) && /token|otp|code/i.test(msg)) {
    return 'That code is incorrect or has expired. Check the latest email, or request a new code.'
  }
  if (/different from the old password/i.test(msg)) {
    return 'Your new password must be different from your current one.'
  }
  return msg || 'Could not update password'
}
