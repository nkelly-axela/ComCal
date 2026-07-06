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
    const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:4px;">ComCal</div>
      <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:16px;">New leave request</div>
      <div style="font-size:14px;color:#374151;line-height:1.6;">
        <p><strong>${esc(fullName)}</strong> has submitted a leave request:</p>
        <p>
          <strong>Type:</strong> ${esc(typeName)}<br/>
          <strong>When:</strong> ${esc(when)}<br/>
          <strong>Amount:</strong> ${esc(amount)}
          ${reason ? `<br/><strong>Reason:</strong> ${esc(reason)}` : ''}
          ${conflict ? `<br/><strong style="color:#b45309;">&#9888; Overlaps with colleagues already off — see admin panel for details.</strong>` : ''}
        </p>
        <p>Please review it in ComCal.</p>
      </div>
      <div style="font-size:12px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">
        This is an automated notification from the Axela leave management system.
      </div>
    </div>`;

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
