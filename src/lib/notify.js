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

const APP_URL = 'https://comcal.axela.co.uk'

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

/**
 * Branded ComCal email wrapper.
 * Table-based + fully inline styles so it renders correctly in
 * Outlook, Gmail and Apple Mail.
 *
 *   emailShell(title, bodyHtml, opts?)
 *     opts.badge  — optional { label, bg, color } status pill
 *                   shown under the title
 */
export function emailShell(title, bodyHtml, opts = {}) {
  const badge = opts.badge
    ? `<tr><td style="padding:0 32px;">
         <span style="display:inline-block;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;padding:4px 12px;border-radius:999px;background:${opts.badge.bg};color:${opts.badge.color};">${opts.badge.label}</span>
       </td></tr>
       <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <!-- Header band -->
        <tr>
          <td style="background:#1D9E75;padding:20px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.2px;">ComCal</td>
              <td align="right" style="font-size:12px;color:#E1F5EE;">Axela Group · Leave Management</td>
            </tr></table>
          </td>
        </tr>

        <!-- Title -->
        <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:0 32px;font-size:18px;font-weight:600;color:#111827;">${title}</td>
        </tr>
        <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
        ${badge}

        <!-- Body -->
        <tr>
          <td style="padding:0 32px;font-size:14px;color:#374151;line-height:1.65;">${bodyHtml}</td>
        </tr>

        <!-- CTA button -->
        <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:0 32px;">
            <a href="${APP_URL}" style="display:inline-block;background:#1D9E75;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:8px;">Open ComCal</a>
          </td>
        </tr>
        <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.6;">
            This is an automated notification from ComCal, the Axela Group leave management system. Please don't reply to this email.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Ready-made badge presets matching the app's status colours. */
export const EMAIL_BADGES = {
  approved:  { label: 'Approved',  bg: '#E1F5EE', color: '#0F6E56' },
  rejected:  { label: 'Rejected',  bg: '#FEE2E2', color: '#991B1B' },
  cancelled: { label: 'Cancelled', bg: '#F3F4F6', color: '#374151' },
  pending:   { label: 'Pending review', bg: '#FAEEDA', color: '#854F0B' },
}
