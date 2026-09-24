// api/send-email.js
// Vercel serverless function — sends email via Resend's REST API.
// Locked down: requires a valid Supabase session token, so only
// logged-in ComCal users (e.g. the admin panel sending outcome
// emails) can use it. Anonymous calls are rejected.
//
// Required Vercel env vars:
//   RESEND_API_KEY
//   SUPABASE_URL               (same value as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  (Supabase → Settings → API — keep secret)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify the caller is a logged-in ComCal user ─────────────
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing to, subject or html' });
  }

  try {
    // Never email deleted users (see api/delete-user.js).
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    const inList = recipients.map(e => `"${String(e).replace(/"/g, '')}"`).join(',');
    const deletedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=in.(${encodeURIComponent(inList)})&deleted_at=not.is.null&select=email`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const deleted = new Set(
      (deletedRes.ok ? await deletedRes.json() : []).map(u => String(u.email).toLowerCase())
    );
    const allowed = recipients.filter(e => !deleted.has(String(e).toLowerCase()));
    if (!allowed.length) {
      return res.status(200).json({ data: { sent: 0, skipped: 'recipient deleted' } });
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ComCal <noreply@axelainnovations.co.uk>',
        to: allowed,
        subject,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(response.status).json({ error: data });
    }

    return res.status(200).json({ data });
  } catch (err) {
    console.error('Send failed:', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
