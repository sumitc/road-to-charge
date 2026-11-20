export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Anonymous app feedback — deliberately has no auth so users never need to log in. */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const page = typeof body.page === 'string' ? body.page.trim() : '';

    // Honeypot: bots fill hidden fields, real users never see it.
    if (typeof body.website === 'string' && body.website.trim()) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (message.length < 3 || message.length > 4000) {
      return new Response(JSON.stringify({ error: 'Message must be between 3 and 4000 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (email.length > 200 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return new Response(JSON.stringify({ error: 'Enter a valid email or leave it blank' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured');

    const html = `
      <h2>Ruvo app feedback</h2>
      <p><strong>Page:</strong> ${escapeHtml(page || 'Not specified')}</p>
      <p><strong>Reply-to:</strong> ${escapeHtml(email || 'Not provided')}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      <p style="color:#64748b;font-size:12px">Sent anonymously from the Ruvo footer. No account login required.</p>
    `;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Ruvo <onboarding@resend.dev>',
        to: [process.env.REVIEW_EMAIL || 'develop.sumit@gmail.com'],
        subject: 'Ruvo app feedback',
        html,
        reply_to: email || undefined,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error('Feedback email failed:', response.status, await response.text());
      throw new Error('Could not deliver feedback');
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('App feedback error:', error);
    return new Response(JSON.stringify({ error: 'Could not send feedback' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
