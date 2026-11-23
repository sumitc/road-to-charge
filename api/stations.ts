import postgres, { type Fragment, type Sql } from 'postgres';
import { waitUntil } from '@vercel/functions';
import {
  claimGoogleAreaRefresh,
  getGoogleRefreshStatus,
  googleAreaCell,
  runGoogleAreaBackfill,
  type GoogleRefreshInfo,
} from '../server/lib/googleAreaBackfill.js';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Expose-Headers': 'X-Ampo-Google-Refresh',
};

const SEARCH_ALIASES: Record<string, string[]> = {
  bangalore: ['bangalore', 'bengaluru'],
  bengaluru: ['bengaluru', 'bangalore'],
  mumbai: ['mumbai', 'bombay'],
  bombay: ['bombay', 'mumbai'],
  chennai: ['chennai', 'madras'],
  madras: ['madras', 'chennai'],
  nallagandla: ['nallagandla', 'nalagandla'],
  // First variant is the canonical spelling used for geocoding.
  nalagandla: ['nallagandla', 'nalagandla'],
  kolkata: ['kolkata', 'calcutta'],
  calcutta: ['calcutta', 'kolkata'],
};

// A searched area is considered covered once it has a handful of rows tied to
// a live provider (Google place id, or a provider feed source). The bulk static
// catalog alone does not count as provider coverage.
const MIN_PROVIDER_STATIONS = 5;

async function countProviderStations(
  sql: Sql,
  lat: number,
  lng: number,
  radiusKm: number
): Promise<number> {
  const latRange = radiusKm / 111.0;
  const lngRange = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM public.ev_charging_stations
    WHERE latitude BETWEEN ${lat - latRange} AND ${lat + latRange}
      AND longitude BETWEEN ${lng - lngRange} AND ${lng + lngRange}
      AND (
        google_place_id IS NOT NULL
        OR source_name ILIKE '%Google%'
        OR source_name ILIKE '%OpenStreetMap%'
        OR source_name ILIKE '%OCPI%'
      )
  `;
  return rows[0]?.count ?? 0;
}

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

    if (mode === 'refresh-status') {
      const cell = params.get('cell') ?? '';
      await sql.end({ timeout: 5 });
      if (!/^-?\d+,-?\d+$/.test(cell)) {
        return new Response(JSON.stringify({ error: 'Valid cell is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const info = await getGoogleRefreshStatus(cell);
      return new Response(JSON.stringify(info ?? { cell, status: 'cached' }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

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
    let resolvedGeo: { lat: number; lng: number } | null = null;
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
        const tokens = q.toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 6);
        searchTokens = tokens;
        for (const token of tokens) {
          const variants = SEARCH_ALIASES[token] ?? [token];
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
    const compact = mode === 'distance' || mode === 'bounds';
    const columns = compact
      ? sql`
          id, station_name, provider, address, city, state, district,
          latitude, longitude, availability_status, connector_types,
          max_power_kw, max_kw_by_standard, charging_current, ownership,
          access, source_name,
          station_type, maps_link, location_quality,
          photo_references[1:1] AS photo_references,
          CASE WHEN place_details IS NULL THEN NULL
               ELSE jsonb_build_object(
                 'rating', place_details->'rating',
                 'match', place_details->'match',
                 'photoQuality', place_details->'photoQuality',
                 'photoSource', place_details->'photoSource'
               ) END AS place_details
        `
      : sql`*`;
    let rows = await sql`
      SELECT ${columns} FROM public.ev_charging_stations
      ${where}
      ORDER BY ${order}
      LIMIT ${limit}
    `;

    // Resolve a location query to an area on the map first, exactly like a
    // current-location search. Text matching remains the fallback only when
    // the geocoder has no answer for the supplied keywords.
    if (mode === 'search' && searchTokens.length > 0) {
      const rawQuery = params.get('q')?.trim() ?? '';
      const canonicalQuery = searchTokens
        .map((token) => SEARCH_ALIASES[token]?.[0] ?? token)
        .join(' ');
      const geocode = async (value: string) => {
        if (!value) return [];
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(value)}`,
          { headers: { 'User-Agent': 'road-to-charge/1.0' }, signal: AbortSignal.timeout(5000) }
        );
        if (!response.ok) return [];
        const results = (await response.json()) as Array<{ lat: string; lon: string }>;
        return results
          .map(geo => ({ lat: Number(geo.lat), lng: Number(geo.lon) }))
          .filter(geo => Number.isFinite(geo.lat) && Number.isFinite(geo.lng));
      };

      const radiusKm = 10;
      const rowsNear = async (geo: { lat: number; lng: number }) => {
        const latRange = radiusKm / 111.0;
        const lngRange = radiusKm / (111.0 * Math.cos((geo.lat * Math.PI) / 180));
        return await sql`
          SELECT * FROM public.ev_charging_stations
          WHERE latitude BETWEEN ${geo.lat - latRange} AND ${geo.lat + latRange}
            AND longitude BETWEEN ${geo.lng - lngRange} AND ${geo.lng + lngRange}
          ORDER BY (abs(latitude::float8 - ${geo.lat}) + abs(longitude::float8 - ${geo.lng})) ASC
          LIMIT 100
        ` as unknown as typeof rows;
      };

      try {
        let candidates = await geocode(canonicalQuery);
        if (candidates.length === 0 && canonicalQuery.toLowerCase() !== rawQuery.toLowerCase()) {
          candidates = await geocode(rawQuery);
        }
        if (candidates.length > 0) {
          // A bare locality can resolve to several same-named places. Score
          // each candidate by the stations we actually hold for that area —
          // no place is special-cased here. Keep Nominatim's relevance order
          // when coverage is comparable; only override a candidate that is
          // effectively empty (e.g. a same-named village elsewhere).
          const scored: Array<{ geo: { lat: number; lng: number }; rows: typeof rows }> = [];
          for (const candidate of candidates) {
            scored.push({ geo: candidate, rows: await rowsNear(candidate) });
          }
          const maxRows = Math.max(...scored.map(entry => entry.rows.length));
          let chosen = scored[0];
          for (const entry of scored) {
            if (entry.rows.length >= maxRows * 0.8) {
              chosen = entry;
              break;
            }
          }
          let best = chosen.geo;
          let bestRows = chosen.rows;

          // If every candidate is empty, use the centroid of literal text
          // matches as the tie-breaker before giving up on the geocode.
          if (bestRows.length === 0 && rows.length > 0) {
            const located = rows as unknown as Array<{ latitude: string | number; longitude: string | number }>;
            const centroidLat = located.reduce((sum, row) => sum + Number(row.latitude), 0) / located.length;
            const centroidLng = located.reduce((sum, row) => sum + Number(row.longitude), 0) / located.length;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (const candidate of candidates) {
              const distance = (candidate.lat - centroidLat) ** 2 + (candidate.lng - centroidLng) ** 2;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
              }
            }
            bestRows = await rowsNear(best);
          }

          if (bestRows.length > 0) {
            resolvedGeo = best;
            rows = bestRows;
          } else if (rows.length === 0) {
            // Genuinely uncovered area: let the coverage check schedule a
            // background refresh around Nominatim's best guess.
            resolvedGeo = best;
          }
        }
      } catch (error) {
        console.error('Geocoding fallback failed:', error);
      }
    }

    // Demand-driven Google gap fill. Before scheduling anything, check whether
    // this area already has enough provider-backed rows in the DB. The response
    // is never blocked on the network call; the cell claim keeps repeat
    // searches idempotent for 7 days.
    let refreshInfo: GoogleRefreshInfo | undefined;
    try {
      let area: { lat: number; lng: number; radiusKm: number } | null = null;
      if (mode === 'distance') {
        const lat = Number(params.get('lat'));
        const lng = Number(params.get('lng'));
        const radiusKm = Number(params.get('radius') ?? 10);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusKm)) {
          area = { lat, lng, radiusKm };
        }
      } else if (mode === 'search') {
        if (resolvedGeo) {
          area = { ...resolvedGeo, radiusKm: 10 };
        } else if (rows.length > 0) {
          const mapped = rows as unknown as Array<{ latitude: string | number; longitude: string | number }>;
          const lat = mapped.reduce((sum, row) => sum + Number(row.latitude), 0) / mapped.length;
          const lng = mapped.reduce((sum, row) => sum + Number(row.longitude), 0) / mapped.length;
          if (Number.isFinite(lat) && Number.isFinite(lng)) area = { lat, lng, radiusKm: 10 };
        }
      }

      if (area) {
        const cell = googleAreaCell(area.lat, area.lng);
        const providerRows = await countProviderStations(sql, area.lat, area.lng, area.radiusKm);
        if (providerRows >= MIN_PROVIDER_STATIONS) {
          console.log(
            `[AmpoGoogleRefresh] cell=${cell} providerRows=${providerRows} coverage sufficient; skipped`
          );
        } else {
          const claim = await claimGoogleAreaRefresh(sql, area.lat, area.lng, area.radiusKm);
          if (claim) {
            refreshInfo = { cell: claim.cell, status: claim.claimed ? 'pending' : 'cached' };
            if (claim.claimed) {
              const task = runGoogleAreaBackfill({ ...claim, ...area });
              try {
                waitUntil(task);
              } catch {
                // Outside a Vercel runtime waitUntil is a no-op; keep the task
                // alive rather than dropping a legitimately claimed refresh.
                task.catch((error) => console.error('Google area backfill failed:', error));
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Could not schedule Google area refresh:', error);
    }

    await sql.end({ timeout: 5 });

    const headers: Record<string, string> = {
      ...corsHeaders,
      'Content-Type': 'application/json',
    };
    if (refreshInfo) {
      headers['X-Ampo-Google-Refresh'] = encodeURIComponent(JSON.stringify(refreshInfo));
    }
    if (mode === 'distance' || mode === 'bounds' || mode === 'id') {
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
