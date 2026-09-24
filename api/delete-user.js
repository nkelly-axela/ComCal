// api/delete-user.js
// ─────────────────────────────────────────────────────────────
// Called from Admin → Employees → Delete.
//
// "Deletes" a user without losing their history:
//   - public.users row is kept (leave requests, allowances and the
//     audit log still reference it) and marked deleted_at / deleted_by,
//     which hides them from the admin Employees list and the calendar.
//   - Their pending requests and future bookings are cancelled, so they
//     don't sit in the approval queue or trigger department conflicts.
//   - Pending invites for their email are removed.
//   - Their Supabase auth account is banned and its email replaced with
//     a dead address, so they can't sign in, can't request a password
//     reset / sign-in code, and Supabase won't email them. Their real
//     email stays on public.users for records.
//
// Security: caller must be signed in AND have role 'admin'. Admins
// can't delete themselves.
//
// Required Vercel env vars (already set for the email functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const svcHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const rest = (path, init = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svcHeaders, ...init.headers } });

  // ── 1. Verify the caller is a signed-in admin ───────────────
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const caller = await userRes.json();

  const { userId } = req.body || {};
  if (!userId || !UUID_RE.test(userId)) {
    return res.status(400).json({ error: 'Missing or invalid userId' });
  }
  if (userId === caller.id) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }

  try {
    const [callerRes, targetRes] = await Promise.all([
      rest(`users?id=eq.${caller.id}&select=role,deleted_at`),
      rest(`users?id=eq.${userId}&select=id,email,full_name,deleted_at`),
    ]);
    if (!callerRes.ok || !targetRes.ok) throw new Error('Could not load users');
    const [callerProfile] = await callerRes.json();
    const [target] = await targetRes.json();

    if (callerProfile?.role !== 'admin' || callerProfile?.deleted_at) {
      return res.status(403).json({ error: 'Only admins can delete users' });
    }
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.deleted_at) return res.status(409).json({ error: 'User is already deleted' });

    // ── 2. Lock the auth account ──────────────────────────────
    // Ban (~100 years) blocks sign-in and token refresh. Swapping the
    // email means password-reset / sign-in-code requests for their real
    // address find no account, so nothing is sent. email_confirm skips
    // any confirmation email for the new address.
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: svcHeaders,
      body: JSON.stringify({
        ban_duration: '876000h',
        email: `deleted-${userId}@deleted.invalid`,
        email_confirm: true,
      }),
    });
    // 404 = no auth account (e.g. profile created by hand) — still soft-delete.
    if (!authRes.ok && authRes.status !== 404) {
      const text = await authRes.text().catch(() => '');
      console.error('Auth update failed:', authRes.status, text);
      throw new Error('Could not disable sign-in for this user');
    }

    // ── 3. Mark the profile deleted (keep their real email) ──
    const now = new Date().toISOString();
    const profRes = await rest(`users?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ deleted_at: now, deleted_by: caller.id, email: target.email }),
    });
    if (!profRes.ok) {
      const text = await profRes.text().catch(() => '');
      console.error('Profile update failed:', profRes.status, text);
      throw new Error('Sign-in was disabled but the profile could not be marked deleted — try again');
    }

    // ── 4. Tidy up open requests and invites (best effort) ───
    const today = now.slice(0, 10);
    const note = 'Cancelled automatically: user deleted';
    await Promise.all([
      // Requests never approved — no longer needed
      rest(`leave_requests?user_id=eq.${userId}&status=eq.pending`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', admin_note: note }),
      }),
      // Booked leave that hasn't started yet. Leave already taken is
      // left exactly as it is.
      rest(`leave_requests?user_id=eq.${userId}&status=in.(approved,cancellation_pending)&start_date=gt.${today}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', admin_note: note }),
      }),
      target.email
        ? rest(`invite_tokens?email=eq.${encodeURIComponent(target.email.toLowerCase())}`, { method: 'DELETE' })
        : null,
    ].filter(Boolean)).then(results => {
      for (const r of results) {
        if (!r.ok) r.text().then(t => console.warn('Cleanup step failed:', r.status, t)).catch(() => {});
      }
    });

    return res.status(200).json({ data: { deleted: userId, name: target.full_name } });
  } catch (err) {
    console.error('Delete user failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete user' });
  }
}
