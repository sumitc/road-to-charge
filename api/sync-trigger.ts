import handler from './sync-ev-stations';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

/**
 * Browser-friendly wrapper around the protected sync endpoint. The shared
 * secret stays server-side; this endpoint only allows a small catalog refresh.
 */
export default async function trigger(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const secret = process.env.SYNC_SECRET;
    if (!secret) throw new Error('SYNC_SECRET is not configured');

    const incoming = new URL(req.url);
    const base = `${incoming.protocol}//${incoming.host}`;
    const target = new URL('/api/sync-ev-stations', base);
    target.searchParams.set('mode', 'catalog');
    target.searchParams.set('maxPagesPerState', '1');

    const response = await handler(new Request(target.toString(), {
      headers: { authorization: `Bearer ${secret}` },
    }));
    const body = await response.json();
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
