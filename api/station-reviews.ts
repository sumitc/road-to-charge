import postgres from 'postgres';
import { fetchGoogleReviews, type ReviewLookup } from '../server/lib/place-enrichment.js';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Google Place IDs are opaque; this only blocks malformed or oversized input.
// The server key is restricted and responses are CDN-cached for a day.
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;

interface ReviewsResponse extends ReviewLookup {
  stationId?: string;
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
  const params = new URL(req.url).searchParams;
  const stationId = params.get('stationId') ?? '';
  const placeId = params.get('placeId') ?? '';
  const byPlaceId = Boolean(placeId);

  if (byPlaceId ? !PLACE_ID_PATTERN.test(placeId) : !UUID_PATTERN.test(stationId)) {
    return respond({ error: 'Valid stationId or placeId is required' }, 400, 60);
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return respond({ error: 'Google Maps is not configured' }, 503, 60);

  const cacheKey = byPlaceId ? `place:${placeId}` : stationId;
  const existing = inFlight.get(cacheKey);
  if (existing) {
    const result = await existing;
    return result ? respond(result) : respond({ error: 'Place not found' }, 404, 60);
  }

  const task = (async (): Promise<ReviewsResponse | null> => {
    // Hotel pages already have an exact Google Place ID from the index; skip
    // the station DB lookup and ask Places directly for that one property.
    if (byPlaceId) {
      const lookup = await fetchGoogleReviews({
        station_name: '',
        address: null,
        latitude: 0,
        longitude: 0,
        google_place_id: placeId,
      }, apiKey);
      return { ...lookup, placeId: lookup.placeId ?? placeId, source: 'Google Maps' };
    }

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

  inFlight.set(cacheKey, task);
  try {
    const result = await task;
    if (!result) return respond({ error: 'Place not found' }, 404, 60);
    return respond(result);
  } catch (error) {
    console.error('Google reviews lookup failed:', error);
    // Degrade gracefully — the community reviews section still works.
    return respond(
      { [byPlaceId ? 'placeId' : 'stationId']: byPlaceId ? placeId : stationId, source: 'Google Maps', reviews: [], error: 'Reviews are temporarily unavailable' },
      200,
      300
    );
  } finally {
    inFlight.delete(cacheKey);
  }
}
