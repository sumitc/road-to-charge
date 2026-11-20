export const config = { runtime: 'nodejs' };

const PHOTO_REF_PATTERN = /^places\/[^/]+\/photos\/[A-Za-z0-9_-]+$/;

/**
 * Server-side proxy for Google Places photos. The API key stays on Vercel and
 * the response is CDN-cached by query string, so repeat list views are cheap.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ref = url.searchParams.get('ref') ?? '';
  const requestedWidth = Number(url.searchParams.get('width') ?? 640);
  const width = Number.isFinite(requestedWidth)
    ? Math.min(Math.max(200, Math.round(requestedWidth)), 1600)
    : 640;

  if (!PHOTO_REF_PATTERN.test(ref)) {
    return new Response('Invalid photo reference', { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return new Response('Photo service is not configured', { status: 503 });
  }

  try {
    const upstream = await fetch(
      `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${width}&key=${encodeURIComponent(apiKey)}`,
      {
        headers: { Accept: 'image/*' },
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!upstream.ok) {
      return new Response(`Google Places photo failed: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Place photo proxy failed:', error);
    return new Response('Could not load photo', { status: 502 });
  }
}
