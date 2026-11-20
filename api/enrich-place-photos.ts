import { runPhotoEnrichment } from './lib/place-enrichment.js';

export const config = { runtime: 'nodejs' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Enrich a batch of stations with Google Places details and photo references. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const auth = req.headers.get('authorization');
  const provided = auth?.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('secret');
  const secrets = [process.env.SYNC_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value)
  );
  if (!provided || !secrets.includes(provided)) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return json({ success: false, error: 'GOOGLE_MAPS_API_KEY is not configured' }, 503);

  const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
  const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(1, requestedLimit), 200) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;

  try {
    const result = await runPhotoEnrichment(apiKey, limit, offset);
    return json({ success: true, ...result });
  } catch (error) {
    console.error('Photo enrichment failed:', error);
    return json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return GET(req);
}
