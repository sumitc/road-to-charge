import postgres, { type Fragment } from 'postgres';

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
    const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!url) throw new Error('POSTGRES_URL / POSTGRES_URL_NON_POOLING is not configured');
    const sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 20, ssl: 'require', prepare: false });
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

    if (mode === 'id') {
      const id = params.get('id') ?? '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        await sql.end({ timeout: 5 });
        return new Response(JSON.stringify({ error: 'Valid station id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const rows = await sql`SELECT * FROM public.ev_charging_stations WHERE id = ${id}::uuid LIMIT 1`;
      await sql.end({ timeout: 5 });
      if (!rows.length) {
        return new Response(JSON.stringify({ error: 'Station not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(rows[0]), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      });
    }

    const conditions: Fragment[] = [];
    let searchTokens: string[] = [];
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
        // Rough proximity sort in SQL; the service computes exact distances.
        order = sql`(abs(latitude::float8 - ${lat}) + abs(longitude::float8 - ${lng})) ASC`;
      }
      const requested = Number(params.get('limit'));
      limit = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, 200)
        : radius <= 10 ? 100 : 200;
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
        const aliases: Record<string, string[]> = {
          bangalore: ['bangalore', 'bengaluru'],
          bengaluru: ['bengaluru', 'bangalore'],
          mumbai: ['mumbai', 'bombay'],
          bombay: ['bombay', 'mumbai'],
          chennai: ['chennai', 'madras'],
          madras: ['madras', 'chennai'],
          kolkata: ['kolkata', 'calcutta'],
          calcutta: ['calcutta', 'kolkata'],
        };
        const tokens = q.toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 6);
        searchTokens = tokens;
        for (const token of tokens) {
          const variants = aliases[token] ?? [token];
          const conditionFor = (variant: string) => {
            const like = `%${variant}%`;
            return sql`(station_name ILIKE ${like} OR address ILIKE ${like} OR provider ILIKE ${like} OR city ILIKE ${like} OR state ILIKE ${like})`;
          };
          // Every term must match somewhere, so "koramangala, bangalore" is
          // understood as locality AND city rather than one literal string.
          const termCondition = variants.length > 1
            ? sql`(${conditionFor(variants[0])} OR ${conditionFor(variants[1])})`
            : conditionFor(variants[0]);
          conditions.push(termCondition);
        }
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

    const combined = conditions.length
      ? conditions.slice(1).reduce(
          (acc, condition) => sql`(${acc}) AND (${condition})`,
          conditions[0]
        )
      : sql``;
    const where = conditions.length ? sql`WHERE ${combined}` : sql``;
    // The list view only needs a subset of columns. Returning full rows
    // (place_details, connectors, audit fields) made this hot path ~107 KB for
    // 36 stations. Only the first photo ref is used on a card.
    const columns = mode === 'distance'
      ? sql`
          id, station_name, provider, address, city, state, district,
          latitude, longitude, availability_status, connector_types,
          max_power_kw, max_kw_by_standard, charging_current, ownership,
          station_type, maps_link, location_quality,
          photo_references[1:1] AS photo_references,
          CASE WHEN place_details IS NULL THEN NULL
               ELSE jsonb_build_object('rating', place_details->'rating') END AS place_details
        `
      : sql`*`;
    let rows = await sql`
      SELECT ${columns} FROM public.ev_charging_stations
      ${where}
      ORDER BY ${order}
      LIMIT ${limit}
    `;

    // If a place query barely matches text, resolve the place to coordinates
    // and return nearby stations. This handles areas like Koramangala that
    // are not labelled as a city in the source catalog.
    if (mode === 'search' && rows.length < 3 && searchTokens.length > 0) {
      try {
        const q = params.get('q') ?? '';
        const geoResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
          { headers: { 'User-Agent': 'road-to-charge/1.0' }, signal: AbortSignal.timeout(5000) }
        );
        if (geoResponse.ok) {
          const geo = (await geoResponse.json())?.[0];
          const lat = Number(geo?.lat);
          const lng = Number(geo?.lon);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const radius = 10;
            const latRange = radius / 111.0;
            const lngRange = radius / (111.0 * Math.cos((lat * Math.PI) / 180));
            rows = await sql`
              SELECT * FROM public.ev_charging_stations
              WHERE latitude BETWEEN ${lat - latRange} AND ${lat + latRange}
                AND longitude BETWEEN ${lng - lngRange} AND ${lng + lngRange}
              ORDER BY (abs(latitude::float8 - ${lat}) + abs(longitude::float8 - ${lng})) ASC
              LIMIT 50
            `;
          }
        }
      } catch (error) {
        console.error('Geocoding fallback failed:', error);
      }
    }

    await sql.end({ timeout: 5 });

    const headers: Record<string, string> = {
      ...corsHeaders,
      'Content-Type': 'application/json',
    };
    if (mode === 'distance' || mode === 'id') {
      // Catalog data changes daily; cached responses make detail views instant.
      // Vercel Functions only honour the CDN header for edge caching.
      headers['Cache-Control'] = 'public, s-maxage=300, stale-while-revalidate=600';
      headers['Vercel-CDN-Cache-Control'] = 'public, s-maxage=300, stale-while-revalidate=600';
    }
    return new Response(JSON.stringify(rows), { headers });
  } catch (error) {
    console.error('Stations API error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
