import postgres from 'postgres';
import { fetchGoogleReviews, type ReviewLookup } from '../server/lib/place-enrichment.js';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReviewsResponse extends ReviewLookup {
  stationId: string;
  /** Shown verbatim in the UI so attribution is never implied. */
  source: 'Google Maps';
}

// Coalesce simultaneous visitors for the same station inside one function
// instance; the CDN handles the rest.
const inFlight = new Map<string, Promise<ReviewsResponse | null>>();

function respond(body: unknown, status = 200, maxAge = 86400): Response {
  const cache = `public, s-maxage=${maxAge}, stale-while-revalidate=604800`;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Vercel-CDN-Cache-Control': cache,
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(req: Request): Promise<Response> {
  const stationId = new URL(req.url).searchParams.get('stationId') ?? '';
  if (!UUID_PATTERN.test(stationId)) {
    return respond({ error: 'Valid stationId is required' }, 400, 60);
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return respond({ error: 'Google Maps is not configured' }, 503, 60);

  const existing = inFlight.get(stationId);
  if (existing) {
    const result = await existing;
    return result ? respond(result) : respond({ error: 'Station not found' }, 404, 60);
  }

  const task = (async (): Promise<ReviewsResponse | null> => {
    const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!url) throw new Error('POSTGRES_URL / POSTGRES_URL_NON_POOLING is not configured');
    const sql = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 20,
      ssl: 'require',
      prepare: false,
    });
    try {
      const rows = await sql<Array<{
        station_name: string;
        address: string | null;
        latitude: number;
        longitude: number;
        google_place_id: string | null;
      }>>`
        SELECT station_name, address, latitude, longitude, google_place_id
        FROM public.ev_charging_stations
        WHERE id = ${stationId}::uuid
        LIMIT 1
      `;
      if (!rows.length) return null;
      const lookup = await fetchGoogleReviews(rows[0], apiKey);
      return { ...lookup, stationId, source: 'Google Maps' };
    } finally {
      await sql.end({ timeout: 5 });
    }
  })();

  inFlight.set(stationId, task);
  try {
    const result = await task;
    if (!result) return respond({ error: 'Station not found' }, 404, 60);
    return respond(result);
  } catch (error) {
    console.error('Google reviews lookup failed:', error);
    // Degrade gracefully — the community reviews section still works.
    return respond(
      { stationId, source: 'Google Maps', reviews: [], error: 'Reviews are temporarily unavailable' },
      200,
      300
    );
  } finally {
    inFlight.delete(stationId);
  }
}
