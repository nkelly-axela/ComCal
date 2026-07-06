/**
 * src/lib/notify.js
 * ─────────────────────────────────────────────────────────────
 * Fire-and-forget email notifications via the Vercel serverless
 * functions (which call Resend server-side).
 *
 * Every call attaches the caller's Supabase session token, which
 * the endpoints verify — so only logged-in ComCal users can send.
 *
 * Never throws — a failed notification must never block or
 * break a leave request action.
 * ─────────────────────────────────────────────────────────────
 */

import { supabase } from './supabase'

async function authedPost(path, body) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.warn('No session — notification skipped')
      return
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('Notification failed:', res.status, text)
    }
  } catch (e) {
    console.warn('Notification failed:', e)
  }
}

/** Notify all admins/managers of a new leave request.
 *  Recipient emails are looked up server-side — never exposed here. */
export function notifyApprovers({ typeName, when, amount, reason, conflict }) {
  return authedPost('/api/notify-request', { typeName, when, amount, reason, conflict })
}

/** Send a specific email (used by the admin panel for outcome emails). */
export function sendEmail({ to, subject, html }) {
  return authedPost('/api/send-email', { to, subject, html })
}

/** Simple branded wrapper so all ComCal emails look consistent. */
export function emailShell(title, bodyHtml) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:4px;">ComCal</div>
    <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:16px;">${title}</div>
    <div style="font-size:14px;color:#374151;line-height:1.6;">${bodyHtml}</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">
      This is an automated notification from the Axela leave management system.
    </div>
  </div>`
}
