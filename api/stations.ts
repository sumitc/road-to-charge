import postgres from 'postgres';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL_NON_POOLING / POSTGRES_URL is not configured');
    const sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 20, ssl: 'require' });
    const params = new URL(req.url, 'http://localhost').searchParams;
    const mode = params.get('mode') ?? 'all';

    if (mode === 'stats') {
      const rows = await sql<{ provider: string; count: number }[]>`
        SELECT provider, count(*)::int AS count
        FROM public.ev_charging_stations
        GROUP BY provider
        ORDER BY count DESC
      `;
      await sql.end({ timeout: 5 });
      const stats: Record<string, number> = {};
      for (const row of rows) stats[row.provider] = row.count;
      return new Response(JSON.stringify(stats), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const conditions: ReturnType<typeof sql>[] = [];
    let order = sql`last_updated DESC`;
    let limit = 500;

    if (mode === 'distance') {
      const lat = Number(params.get('lat'));
      const lng = Number(params.get('lng'));
      const radius = Number(params.get('radius') ?? 10);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius)) {
        const latRange = radius / 111.0;
        const lngRange = radius / (111.0 * Math.cos((lat * Math.PI) / 180));
        conditions.push(sql`latitude BETWEEN ${lat - latRange} AND ${lat + latRange}`);
        conditions.push(sql`longitude BETWEEN ${lng - lngRange} AND ${lng + lngRange}`);
      }
    } else if (mode === 'bounds') {
      const minLat = Number(params.get('minLat'));
      const maxLat = Number(params.get('maxLat'));
      const minLng = Number(params.get('minLng'));
      const maxLng = Number(params.get('maxLng'));
      if ([minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
        conditions.push(sql`latitude BETWEEN ${minLat} AND ${maxLat}`);
        conditions.push(sql`longitude BETWEEN ${minLng} AND ${maxLng}`);
      }
    } else if (mode === 'search') {
      const q = params.get('q')?.trim();
      if (q) {
        const like = `%${q.replace(/\s+/g, ' ')}%`;
        conditions.push(sql`(station_name ILIKE ${like} OR address ILIKE ${like} OR provider ILIKE ${like} OR city ILIKE ${like} OR state ILIKE ${like})`);
        order = sql`station_name ASC`;
        limit = 50;
      }
    } else if (mode === 'filters') {
      const minPowerKw = params.get('minPowerKw');
      if (minPowerKw && Number.isFinite(Number(minPowerKw))) {
        conditions.push(sql`max_power_kw >= ${Number(minPowerKw)}`);
      }
      const vehicleClass = params.get('vehicleClass');
      if (vehicleClass) conditions.push(sql`vehicle_classes @> ${[vehicleClass]}`);
      const current = params.get('current');
      if (current) conditions.push(sql`charging_current ILIKE ${`%${current}%`}`);
      const connector = params.get('connector');
      if (connector) conditions.push(sql`connector_types @> ${[connector]}`);
      const state = params.get('state');
      if (state) conditions.push(sql`state ILIKE ${state}`);
      const city = params.get('city');
      if (city) conditions.push(sql`city ILIKE ${`%${city}%`}`);
      const ownership = params.get('ownership');
      if (ownership) conditions.push(sql`ownership = ${ownership}`);
      const stationType = params.get('stationType');
      if (stationType) conditions.push(sql`station_type = ${stationType}`);
      order = sql`max_power_kw DESC NULLS LAST`;
      const requested = Number(params.get('limit'));
      if (Number.isFinite(requested) && requested > 0) limit = Math.min(requested, 500);
    }

    const combined = conditions.reduce(
      (acc, condition) => sql`${acc} AND ${condition}`,
      sql``
    );
    const where = conditions.length ? sql`WHERE ${combined}` : sql``;
    const rows = await sql`
      SELECT * FROM public.ev_charging_stations
      ${where}
      ORDER BY ${order}
      LIMIT ${limit}
    `;
    await sql.end({ timeout: 5 });

    return new Response(JSON.stringify(rows), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Stations API error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
