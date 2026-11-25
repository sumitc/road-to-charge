#!/usr/bin/env node
/**
 * Refresh the manual, quality-gated station snapshot used for crawler-visible
 * /station/:id shells. This is deliberately a manual script: no cron, no new
 * Vercel function, no DB migration and no nightly-enrichment change.
 *
 * Gate: a real Google Place ID or a cached Google photo, valid coordinates and
 * a readable station name. Duplicate Google Places are reduced to the most
 * complete DB row so crawlers do not see near-identical pages. Garbled names
 * are excluded rather than published as bad titles.
 *
 *   node scripts/refresh-station-seo-snapshot.mjs
 *   node scripts/refresh-station-seo-snapshot.mjs --limit=25 --dry-run
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'src/data/stations-seo.generated.json');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const limitArg = [...args].find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
if (!url) throw new Error('POSTGRES_URL / POSTGRES_URL_NON_POOLING is required');
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error('--limit must be a positive integer');
}

// Same ranges used by the runtime garbled-text fallback in src/lib/provider.ts.
const hasGarbledText = value => /[\u0000-\u001f\u0100-\u024f\u0370-\u03ff]/.test(value ?? '');
const clean = value => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

function completeness(row) {
  return Number(Boolean(row.googlePlaceId))
    + Number(Boolean(row.photoRef))
    + Number(Boolean(row.address))
    + Number(Boolean(row.city))
    + Number(Boolean(row.state))
    + Number(Boolean(row.sourceUrl))
    + (row.connectorTypes?.length ?? 0)
    + Number(Number(row.maxPowerKw) > 0);
}

function dedupeKey(row) {
  if (row.googlePlaceId) return `place:${row.googlePlaceId}`;
  const name = row.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `row:${name}|${row.lat.toFixed(4)}|${row.lng.toFixed(4)}`;
}

const sql = postgres(url, { max: 1, ssl: 'require', prepare: false, connect_timeout: 20 });
try {
  const rows = await sql`
    select
      id::text,
      station_name,
      provider,
      address,
      city,
      state,
      district,
      latitude::float8 as lat,
      longitude::float8 as lng,
      connector_types,
      max_power_kw,
      total_connectors,
      source_name,
      source_url,
      google_place_id,
      photo_references,
      maps_link,
      updated_at
    from ev_charging_stations
    where (google_place_id is not null or coalesce(cardinality(photo_references), 0) > 0)
      and latitude is not null
      and longitude is not null
      and nullif(trim(station_name), '') is not null
    order by id
  `;

  const stats = {
    scanned: rows.length,
    garbledExcluded: 0,
    duplicatesExcluded: 0,
    included: 0,
  };
  const best = new Map();
  for (const row of rows) {
    const name = clean(row.station_name);
    if (hasGarbledText(name)) {
      stats.garbledExcluded++;
      continue;
    }
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const station = {
      id: row.id,
      name,
      provider: clean(row.provider) || 'Unlisted network',
      address: clean(row.address),
      city: clean(row.city),
      state: clean(row.state),
      district: clean(row.district),
      lat,
      lng,
      connectorTypes: (row.connector_types ?? []).map(clean).filter(Boolean),
      maxPowerKw: row.max_power_kw == null ? null : Number(row.max_power_kw),
      totalConnectors: row.total_connectors == null ? null : Number(row.total_connectors),
      sourceName: clean(row.source_name) || 'Ampo station catalogue',
      sourceUrl: clean(row.source_url) || null,
      googlePlaceId: clean(row.google_place_id) || null,
      photoRef: clean(row.photo_references?.[0]) || null,
      mapsLink: clean(row.maps_link)
        || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
    const key = dedupeKey(station);
    const previous = best.get(key);
    if (!previous || completeness(station) > completeness(previous)) {
      if (previous) stats.duplicatesExcluded++;
      best.set(key, station);
    } else {
      stats.duplicatesExcluded++;
    }
  }

  let stations = [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (limit !== null) stations = stations.slice(0, limit);
  stats.included = stations.length;

  const snapshot = {
    generatedAt: new Date().toISOString(),
    method: {
      sourceTable: 'ev_charging_stations',
      gate: 'google_place_id present or cached photo_references present; valid coordinates; readable name',
      dedupe: 'one page per google_place_id, else normalized name + 4dp coordinates',
      garbledNames: 'excluded',
      refresh: 'manual via npm run seo:stations; no cron or runtime endpoint',
    },
    stats,
    stations,
  };

  if (dryRun) {
    console.log(JSON.stringify({ ...stats, dryRun: true, sample: stations.slice(0, 3) }, null, 2));
  } else {
    // Minified: this file ships with the build, so keep the 5.6K-row index small.
    await fs.writeFile(OUT, `${JSON.stringify(snapshot)}\n`);
    console.log(`Station SEO snapshot written: ${OUT}`);
    console.log(JSON.stringify(stats));
  }
} finally {
  await sql.end();
}
