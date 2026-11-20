/**
 * One-call-per-station photo backfill for rows that were already catalogued
 * but never got an image. Borrows only from very close landmarks (75 m) and
 * stores an explicit disclosure in `place_details.photoSource`.
 *
 * Usage:
 *   node --experimental-strip-types scripts/backfill-landmark-photos.mjs --limit=100
 *   node --experimental-strip-types scripts/backfill-landmark-photos.mjs --dry-run
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { backfillPhotosFromLandmark, createEnrichmentDb } from '../server/lib/place-enrichment.ts';

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
const dryRun = args.has('--dry-run');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 2000;
const stateArg = process.argv.find(arg => arg.startsWith('--state='));
const state = stateArg ? stateArg.split('=')[1] : null;

const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });
const stateFilter = state ? sql`AND lower(state) = ${state.toLowerCase()}` : sql``;
const stations = await sql`
  SELECT id, station_name, provider, address, city, state, latitude, longitude, place_details
  FROM public.ev_charging_stations
  WHERE photo_enriched_at IS NOT NULL
    AND coalesce(cardinality(photo_references), 0) = 0
    AND NOT (place_details ? 'photoSource')
    ${stateFilter}
  ORDER BY updated_at DESC
  LIMIT ${limit}
`;
await sql.end();

console.log(`Backfilling ${stations.length} stations${state ? ` in ${state}` : ''}${dryRun ? ' (dry run)' : ''}`);
if (dryRun) process.exit(0);

const db = createEnrichmentDb();
let improved = 0;
let failed = 0;
for (const station of stations) {
  try {
    const existing = station.place_details && typeof station.place_details === 'object'
      ? station.place_details
      : {};
    const result = await backfillPhotosFromLandmark(station, apiKey, existing);
    if (!result || result.photoRefs.length === 0) continue;
    await db.updatePhotos(station.id, result.photoRefs, result.details);
    improved++;
    process.stdout.write(`\r${improved} repaired, ${failed} failed`);
  } catch (error) {
    failed++;
    console.warn(`\nFailed ${station.station_name}:`, error instanceof Error ? error.message : error);
  }
}
console.log('');
await db.close();
