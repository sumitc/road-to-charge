import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

export const config = { runtime: 'nodejs' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['working', 'not_working', 'wrong_location', 'other']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function createDb() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL / POSTGRES_URL_NON_POOLING is not configured');
  return postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: 'require',
    prepare: false,
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(req: Request): Promise<Response> {
  const stationId = new URL(req.url).searchParams.get('stationId') ?? '';
  if (!UUID_PATTERN.test(stationId)) return json({ error: 'Valid stationId is required' }, 400);

  const sql = createDb();
  try {
    const [counts, lastWorking, lastNotWorking, recent] = await Promise.all([
      sql<{ kind: string; count: number }[]>`
        SELECT kind, count(*)::int AS count
        FROM public.station_feedback
        WHERE station_id = ${stationId}::uuid
        GROUP BY kind
      `,
      sql<{ created_at: Date | string }[]>`
        SELECT created_at FROM public.station_feedback
        WHERE station_id = ${stationId}::uuid AND kind = 'working'
        ORDER BY created_at DESC LIMIT 1
      `,
      sql<{ created_at: Date | string }[]>`
        SELECT created_at FROM public.station_feedback
        WHERE station_id = ${stationId}::uuid AND kind = 'not_working'
        ORDER BY created_at DESC LIMIT 1
      `,
      sql<{ kind: string; note: string | null; created_at: Date | string }[]>`
        SELECT kind, note, created_at FROM public.station_feedback
        WHERE station_id = ${stationId}::uuid
        ORDER BY created_at DESC LIMIT 5
      `,
    ]);

    const byKind: Record<string, number> = {};
    for (const row of counts) byKind[row.kind] = row.count;

    return json({
      total: counts.reduce((sum, row) => sum + row.count, 0),
      working: byKind.working ?? 0,
      notWorking: byKind.not_working ?? 0,
      wrongLocation: byKind.wrong_location ?? 0,
      other: byKind.other ?? 0,
      lastWorkingAt: lastWorking[0]?.created_at ?? null,
      lastNotWorkingAt: lastNotWorking[0]?.created_at ?? null,
      recent: recent.map(row => ({
        kind: row.kind,
        note: row.note,
        createdAt: row.created_at,
      })),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { stationId?: string; kind?: string; note?: string };
    const stationId = String(body.stationId ?? '');
    const kind = String(body.kind ?? '');
    const note = String(body.note ?? '').slice(0, 1000).trim();

    if (!UUID_PATTERN.test(stationId)) return json({ error: 'Valid stationId is required' }, 400);
    if (!KINDS.has(kind)) return json({ error: 'Invalid feedback type' }, 400);

    const sql = createDb();
    try {
      const station = await sql`
        SELECT id FROM public.ev_charging_stations WHERE id = ${stationId}::uuid LIMIT 1
      `;
      if (!station.length) return json({ error: 'Station not found' }, 404);

      await sql`
        INSERT INTO public.station_feedback (id, station_id, kind, note)
        VALUES (${randomUUID()}, ${stationId}::uuid, ${kind}, ${note || null})
      `;
      return json({ success: true });
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (error) {
    console.error('Feedback failed:', error);
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}
