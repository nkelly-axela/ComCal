/**
 * src/lib/notify.js
 * ─────────────────────────────────────────────────────────────
 * Fire-and-forget email notifications via the /api/send-email
 * Vercel serverless function (which calls Resend server-side).
 *
 * Never throws — a failed notification must never block or
 * break a leave request action.
 * ─────────────────────────────────────────────────────────────
 */

export async function sendEmail({ to, subject, html }) {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn('Email notification failed:', res.status, body)
    }
  } catch (e) {
    console.warn('Email notification failed:', e)
  }
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
