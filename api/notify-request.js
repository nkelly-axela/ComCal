// api/notify-request.js
// ─────────────────────────────────────────────────────────────
// Called by the frontend when a leave request is submitted.
// Looks up admin/manager emails SERVER-SIDE (service role key),
// so recipient addresses are never exposed to the browser.
//
// Security: requires a valid Supabase session token — only
// logged-in ComCal users can trigger a notification.
//
// Required Vercel env vars:
//   RESEND_API_KEY             (already set)
//   SUPABASE_URL               (same value as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  (Supabase → Settings → API — keep secret)
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // ── 1. Verify the caller is a logged-in ComCal user ─────────
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const authUser = await userRes.json();

  const { typeName, when, amount, reason, conflict } = req.body || {};
  if (!typeName || !when || !amount) {
    return res.status(400).json({ error: 'Missing request details' });
  }

  try {
    const svcHeaders = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    };

    // ── 2. Look up requester name + approver emails privately ──
    const [nameRes, approverRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=full_name`, { headers: svcHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/users?role=in.(admin,manager)&select=email`, { headers: svcHeaders }),
    ]);

    const nameRows = nameRes.ok ? await nameRes.json() : [];
    const approverRows = approverRes.ok ? await approverRes.json() : [];

    const fullName = nameRows[0]?.full_name ?? authUser.email ?? 'An employee';
    const emails = [...new Set(approverRows.map(a => a.email).filter(Boolean))];

    if (!emails.length) {
      console.warn('No approver emails found — nothing sent');
      return res.status(200).json({ data: { sent: 0 } });
    }

    // ── 3. Send via Resend ──────────────────────────────────────
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const row = (k, v) => `<tr>
      <td style="padding:8px 14px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${k}</td>
      <td style="padding:8px 14px;font-size:13px;color:#111827;font-weight:500;">${v}</td>
    </tr>`;

    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr>
          <td style="background:#1D9E75;padding:20px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.2px;">ComCal</td>
              <td align="right" style="font-size:12px;color:#E1F5EE;">Axela Group · Leave Management</td>
            </tr></table>
          </td>
        </tr>
        <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:0 32px;font-size:18px;font-weight:600;color:#111827;">New leave request</td></tr>
        <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:0 32px;">
          <span style="display:inline-block;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;padding:4px 12px;border-radius:999px;background:#FAEEDA;color:#854F0B;">Pending review</span>
        </td></tr>
        <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:0 32px;font-size:14px;color:#374151;line-height:1.65;">
            <p style="margin:0 0 14px;"><strong>${esc(fullName)}</strong> has submitted a leave request:</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
              ${row('Type', esc(typeName))}
              ${row('When', esc(when))}
              ${row('Amount', esc(amount))}
              ${reason ? row('Reason', esc(reason)) : ''}
            </table>
            ${conflict ? `<p style="margin:14px 0 0;padding:10px 14px;background:#FAEEDA;border-radius:8px;font-size:13px;color:#854F0B;"><strong>&#9888; Conflict flagged</strong> — this request overlaps with colleagues already off. See the admin panel for details.</p>` : ''}
          </td>
        </tr>
        <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:0 32px;">
            <a href="https://comcal.axela.co.uk" style="display:inline-block;background:#1D9E75;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:8px;">Review in ComCal</a>
          </td>
        </tr>
        <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.6;">
            This is an automated notification from ComCal, the Axela Group leave management system. Please don't reply to this email.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ComCal <noreply@axelainnovations.co.uk>',
        to: emails,
        subject: `New leave request from ${fullName}`,
        html,
      }),
    });

    const data = await sendRes.json();
    if (!sendRes.ok) {
      console.error('Resend error:', data);
      return res.status(sendRes.status).json({ error: data });
    }

    return res.status(200).json({ data });
  } catch (err) {
    console.error('notify-request failed:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
