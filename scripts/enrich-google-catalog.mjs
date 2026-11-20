/**
 * Enrich only the Google Places catalog rows (Kokapet / Hyderabad gap fill).
 * Avoids spending Google Places credits on the full 29k BEE snapshot at once.
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

const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });
const stations = await sql`
  SELECT id, station_name, provider, address, city, state, latitude, longitude
  FROM public.ev_charging_stations
  WHERE photo_enriched_at IS NULL AND source_name = 'Google Places API (New)'
  ORDER BY station_name
`;
await sql.end();

console.log(`Enriching ${stations.length} Google catalog stations`);
const db = createEnrichmentDb();
let photos = 0;
for (const station of stations) {
  try {
    const result = await enrichStation(station, apiKey);
    await db.update(station.id, result.placeId, result.photoRefs, result.details);
    if (result.photoRefs.length > 0) photos++;
    process.stdout.write(`\r${photos} with photos / ${stations.length} processed`);
  } catch (error) {
    console.warn(`\nFailed ${station.station_name}:`, error instanceof Error ? error.message : error);
  }
}
console.log('');
await db.close();
