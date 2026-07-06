// api/send-email.js
// Vercel serverless function — sends email via Resend's REST API.
// Requires the RESEND_API_KEY environment variable (already set in Vercel).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html } = req.body || {};

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing to, subject or html' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ComCal <noreply@axelainnovations.co.uk>',
        to,
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
