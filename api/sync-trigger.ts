import { POST as runSync } from './sync-ev-stations.js';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

/**
 * Browser-friendly wrapper around the protected sync endpoint. The shared
 * secret stays server-side; this endpoint only allows a small catalog refresh.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const secret = process.env.SYNC_SECRET;
    if (!secret) throw new Error('SYNC_SECRET is not configured');

    const target = new URL('http://localhost/api/sync-ev-stations');
    target.searchParams.set('mode', 'catalog');
    target.searchParams.set('maxPagesPerState', '1');

    const response = await runSync(new Request(target.toString(), {
      method: 'POST',
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
