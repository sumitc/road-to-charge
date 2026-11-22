/**
 * Demand-driven Google Places gap fill.
 *
 * A user search that has no Google-sourced rows in its circle claims a rounded
 * map cell and schedules a small background job. The job searches that circle,
 * enriches near-duplicate BEE rows with the Google place id, and inserts only
 * genuinely new places. A cache marker prevents the same cell being fetched on
 * every keystroke, and a log row makes every refresh observable.
 *
 * Nothing here is called from the browser; GOOGLE_MAPS_API_KEY stays server-side.
 */
import postgres, { type Sql } from 'postgres';

export type GoogleRefreshStatus = 'pending' | 'done' | 'empty' | 'failed' | 'cached';

export interface GoogleRefreshInfo {
  cell: string;
  status: GoogleRefreshStatus;
  foundCount?: number;
  newCount?: number;
  enrichedCount?: number;
  checkedAt?: string;
  message?: string;
}

export interface GoogleBackfillParams {
  cell: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

const CELL_SIZE = 0.05; // ~5 km at Indian latitudes
const CACHE_TTL_DAYS = 7;
const STALE_PENDING_MINUTES = 10;
const MAX_RADIUS_KM = 10;

/** Keep this identical to src/lib/googleArea.ts. */
export function googleAreaCell(lat: number, lng: number): string {
  return `${Math.round(lat / CELL_SIZE)},${Math.round(lng / CELL_SIZE)}`;
}

function clampRadius(radiusKm: number): number {
  if (!Number.isFinite(radiusKm)) return MAX_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(1, radiusKm));
}

function parseKw(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normaliseConnector(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('ccs') || lower.includes('combo')) return 'CCS';
  if (lower.includes('chademo')) return 'CHAdeMO';
  if (lower.includes('type 2') || lower === 'type2') return 'Type 2';
  if (lower.includes('bharat')) return 'Bharat AC';
  return value;
}

function openDb(): Sql {
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

/**
 * Claim a cell for a background refresh. Returns `claimed: false` when a
 * recent result already exists or another refresh is still in flight.
 */
export async function claimGoogleAreaRefresh(
  sql: Sql,
  lat: number,
  lng: number,
  radiusKm: number
): Promise<{ cell: string; claimed: boolean } | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cell = googleAreaCell(lat, lng);
  const radius = clampRadius(radiusKm);
  const claimed = await sql<{ cell: string }[]>`
    INSERT INTO public.google_area_cache
      (cell, center_lat, center_lng, radius_km, status, last_checked_at)
    VALUES
      (${cell}, ${lat}, ${lng}, ${radius}, 'pending', now())
    ON CONFLICT (cell) DO UPDATE SET
      center_lat = EXCLUDED.center_lat,
      center_lng = EXCLUDED.center_lng,
      radius_km = EXCLUDED.radius_km,
      status = 'pending',
      last_checked_at = now(),
      updated_at = now()
    WHERE (
      public.google_area_cache.status <> 'pending'
      AND public.google_area_cache.last_checked_at < now() - make_interval(days => ${CACHE_TTL_DAYS})
    ) OR (
      public.google_area_cache.status = 'pending'
      AND public.google_area_cache.updated_at < now() - make_interval(mins => ${STALE_PENDING_MINUTES})
    )
    RETURNING cell
  `;

  return { cell, claimed: claimed.length > 0 };
}

/** Read the latest state for a cell. Used by the UI refresh notice. */
export async function getGoogleRefreshStatus(cell: string): Promise<GoogleRefreshInfo | null> {
  if (!/^-?\d+,-?\d+$/.test(cell)) return null;
  const sql = openDb();
  try {
    const rows = await sql<{
      cell: string;
      status: GoogleRefreshStatus;
      found_count: number;
      new_count: number;
      enriched_count: number;
      last_checked_at: string;
      message: string | null;
    }[]>`
      SELECT c.cell, c.status, c.found_count, c.new_count,
             c.enriched_count, c.last_checked_at, l.message
      FROM public.google_area_cache c
      LEFT JOIN LATERAL (
        SELECT message FROM public.google_area_refresh_log
        WHERE cell = c.cell ORDER BY created_at DESC LIMIT 1
      ) l ON true
      WHERE c.cell = ${cell}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      cell: row.cell,
      status: row.status,
      foundCount: row.found_count,
      newCount: row.new_count,
      enrichedCount: row.enriched_count,
      checkedAt: new Date(row.last_checked_at).toISOString(),
      message: row.message ?? undefined,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function finish(
  sql: Sql,
  params: GoogleBackfillParams,
  status: Exclude<GoogleRefreshStatus, 'pending' | 'cached'>,
  counts: { found: number; inserted: number; enriched: number },
  message: string,
  startedAt: number
): Promise<GoogleRefreshInfo> {
  const durationMs = Date.now() - startedAt;
  await sql`
    UPDATE public.google_area_cache
    SET status = ${status},
        found_count = ${counts.found},
        new_count = ${counts.inserted},
        enriched_count = ${counts.enriched},
        last_checked_at = now(),
        updated_at = now()
    WHERE cell = ${params.cell}
  `;
  await sql`
    INSERT INTO public.google_area_refresh_log
      (cell, status, found_count, new_count, enriched_count, duration_ms, message)
    VALUES
      (${params.cell}, ${status}, ${counts.found}, ${counts.inserted},
       ${counts.enriched}, ${durationMs}, ${message})
  `;
  console.log(
    `[AmpoGoogleRefresh] cell=${params.cell} status=${status} found=${counts.found} ` +
      `new=${counts.inserted} enriched=${counts.enriched} duration=${durationMs}ms`
  );
  return {
    cell: params.cell,
    status,
    foundCount: counts.found,
    newCount: counts.inserted,
    enrichedCount: counts.enriched,
    checkedAt: new Date().toISOString(),
    message,
  };
}

/** Background job: one Google circle fetch + conservative upsert. */
export async function runGoogleAreaBackfill(params: GoogleBackfillParams): Promise<GoogleRefreshInfo> {
  const startedAt = Date.now();
  const sql = openDb();
  const counts = { found: 0, inserted: 0, enriched: 0 };

  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY missing');

    const radiusMeters = Math.round(clampRadius(params.radiusKm) * 1000);
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.evChargeOptions',
          'places.rating',
          'places.businessStatus',
        ].join(','),
      },
      body: JSON.stringify({
        includedTypes: ['ev_charging_station'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: params.lat, longitude: params.lng },
            radius: radiusMeters,
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) throw new Error(`Google Places searchNearby returned ${response.status}`);
    const payload = (await response.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        rating?: number;
        businessStatus?: string;
        evChargeOptions?: {
          connectorCount?: number;
          connectorAggregation?: Array<{
            type?: string;
            count?: number;
            maxChargeRateKw?: number;
          }>;
        };
      }>;
    };

    const places = Array.isArray(payload.places) ? payload.places : [];
    const seen = new Set<string>();

    for (const place of places) {
      const placeId = place.id;
      const lat = Number(place.location?.latitude);
      const lng = Number(place.location?.longitude);
      if (!placeId || !Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(placeId)) continue;
      seen.add(placeId);
      counts.found += 1;

      const aggregations = place.evChargeOptions?.connectorAggregation ?? [];
      const connectors = aggregations.map((agg) => ({
        standard: normaliseConnector(String(agg.type ?? '')),
        kw: parseKw(agg.maxChargeRateKw),
        count: agg.count,
      }));
      const outputs = connectors.map((c) => c.kw).filter((kw): kw is number => kw !== undefined);
      const details = {
        rating: place.rating ?? null,
        businessStatus: place.businessStatus ?? null,
        photoSource: 'Google Maps',
        googleCheckedAt: new Date().toISOString(),
      };

      // Prefer an existing row within ~150 m. BEE names are often just an
      // address, so proximity + saved place id is safer than name matching.
      const latRange = 0.0015;
      const lngRange = latRange / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const existing = await sql<{ id: string }[]>`
        SELECT id
        FROM public.ev_charging_stations
        WHERE latitude BETWEEN ${lat - latRange} AND ${lat + latRange}
          AND longitude BETWEEN ${lng - lngRange} AND ${lng + lngRange}
        ORDER BY
          CASE WHEN google_place_id = ${placeId} THEN 0 ELSE 1 END,
          (abs(latitude::float8 - ${lat}) + abs(longitude::float8 - ${lng})) ASC
        LIMIT 1
      `;

      if (existing.length) {
        await sql`
          UPDATE public.ev_charging_stations
          SET google_place_id = ${placeId},
              place_details = COALESCE(place_details, '{}'::jsonb) || ${sql.json(details)},
              updated_at = now()
          WHERE id = ${existing[0].id}::uuid
        `;
        counts.enriched += 1;
        continue;
      }

      const stationName = place.displayName?.text || 'EV Charging Station';
      const result = await sql<{ id: string; inserted: boolean }[]>`
        INSERT INTO public.ev_charging_stations (
          station_name, provider, latitude, longitude, address,
          connector_types, availability_status, external_id, maps_link,
          connectors, max_power_kw, max_kw_by_standard, total_connectors,
          google_place_id, place_details, source_name, source_url, updated_at
        ) VALUES (
          ${stationName},
          ${'Google Places'},
          ${lat},
          ${lng},
          ${place.formattedAddress || 'Address not available'},
          ${connectors.map((c) => c.standard)},
          ${'unknown'},
          ${`google_${placeId}`},
          ${`https://www.google.com/maps/place/?q=place_id:${placeId}`},
          ${sql.json(connectors)},
          ${outputs.length ? Math.max(...outputs) : null},
          ${sql.json(Object.fromEntries(
            connectors
              .filter((c) => c.kw !== undefined)
              .map((c) => [c.standard, c.kw as number])
          ))},
          ${place.evChargeOptions?.connectorCount ?? null},
          ${placeId},
          ${sql.json(details)},
          ${'Google Places API (New)'},
          ${'https://developers.google.com/maps/documentation/places/web-service'},
          now()
        )
        ON CONFLICT (provider, station_name, latitude, longitude) DO UPDATE SET
          google_place_id = EXCLUDED.google_place_id,
          place_details = COALESCE(public.ev_charging_stations.place_details, '{}'::jsonb)
            || EXCLUDED.place_details,
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `;
      if (result[0]?.inserted) counts.inserted += 1;
      else counts.enriched += 1;
    }

    const status = counts.found === 0 ? 'empty' : 'done';
    const message =
      `Google Places returned ${counts.found} station(s); ${counts.inserted} new, ` +
      `${counts.enriched} matched or enriched.`;
    return await finish(sql, params, status, counts, message, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[AmpoGoogleRefresh] failed:', message);
    return await finish(sql, params, 'failed', counts, message, startedAt);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
