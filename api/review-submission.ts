import { runReview } from './lib/submission-review.js';

export const config = { runtime: 'nodejs' };

/** Re-run Google/OSM checks and the review email for an existing submission. */
export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  const secrets = [process.env.SYNC_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length > 0 && !secrets.some(secret => auth === `Bearer ${secret}`)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as { id?: string };
    if (!body.id) throw new Error('id is required');
    const result = await runReview(body.id);
    return new Response(
      JSON.stringify({
        success: true,
        id: body.id,
        recommendation: result.findings.recommendation,
        email: result.email,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
