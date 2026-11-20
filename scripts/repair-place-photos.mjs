/**
 * Re-run photo matching for already-enriched stations that still have no
 * usable image. Uses the current landmark-conflation + photo-ranking logic.
 *
 * Usage:
 *   node --experimental-strip-types scripts/repair-place-photos.mjs
 *   node --experimental-strip-types scripts/repair-place-photos.mjs --all --include-unscored --limit 500
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { createEnrichmentDb, enrichStation } from '../server/lib/place-enrichment.ts';

function loadEnv() {
  if (!fs.existsSync('.env.vercel')) return;
  for (const line of fs.readFileSync('.env.vercel', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    if (!process.env[key]) {
      process.env[key] = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY missing');

const args = new Set(process.argv.slice(2));
const allIndia = args.has('--all');
const includeUnscored = args.has('--include-unscored');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 200;

const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });

const needsRepair = includeUnscored
  ? sql`TRUE`
  : sql`(coalesce(cardinality(photo_references), 0) = 0 OR place_details->>'photoQuality' = 'poor')`;
const area = allIndia
  ? sql`TRUE`
  : sql`(lower(address) LIKE '%hyderabad%' OR lower(city) LIKE '%hyderabad%' OR lower(district) LIKE '%hyderabad%')`;
const sourceFilter = args.has('--google-only')
  ? sql`source_name = 'Google Places API (New)'`
  : sql`TRUE`;

const stations = await sql`
  SELECT id, station_name, provider, address, city, state, latitude, longitude
  FROM public.ev_charging_stations
  WHERE photo_enriched_at IS NOT NULL
    AND ${needsRepair}
    AND ${area}
    AND ${sourceFilter}
  ORDER BY updated_at DESC
  LIMIT ${limit}
`;
await sql.end();

console.log(`Repairing ${stations.length} stations (${allIndia ? 'all India' : 'Hyderabad'}, ${includeUnscored ? 'including unscored' : 'no/poor photos only'})`);
const db = createEnrichmentDb();
let improved = 0;
let withLandmark = 0;

for (const station of stations) {
  try {
    const result = await enrichStation(station, apiKey);
    if (result.photoRefs.length === 0) continue;
    await db.update(station.id, result.placeId, result.photoRefs, result.details);
    improved++;
    if (result.details.photoSource) withLandmark++;
    process.stdout.write(`\r${improved} repaired, ${withLandmark} via nearby landmark`);
  } catch (error) {
    console.warn(`\nFailed ${station.station_name}:`, error instanceof Error ? error.message : error);
  }
}

console.log('');
await db.close();
