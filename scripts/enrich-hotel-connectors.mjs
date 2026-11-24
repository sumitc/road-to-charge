#!/usr/bin/env node
/**
 * Add real connector types to the hotel EV index from Google Places.
 *
 * The hotel builder only stores nearby charger place IDs / names. Google Places
 * (New) exposes `evChargeOptions.connectorAggregation` for many of those exact
 * places; this script reads it for each unique charger and writes canonical
 * filter values onto the hotel and its nearest charger. No reviews, prices or
 * invented connector data are stored.
 *
 *   source .env.local
 *   node scripts/enrich-hotel-connectors.mjs
 *
 * A 30-day cache in the OS temp dir keeps repeat runs cheap. Re-run after a
 * fresh `build-hotels-ev-index.mjs` pass, which replaces this generated file.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const INDEX_PATH = path.join(ROOT, 'src/data/hotels-ev.index.generated.json');
const CACHE_PATH = path.join(os.tmpdir(), 'ampo-hotel-connector-cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FIELD_MASK = 'id,evChargeOptions.connectorAggregation.type';

const GOOGLE_TO_FILTER = {
  EV_CONNECTOR_TYPE_CCS_COMBO_1: 'ccs',
  EV_CONNECTOR_TYPE_CCS_COMBO_2: 'ccs',
  EV_CONNECTOR_TYPE_CHADEMO: 'chademo',
  EV_CONNECTOR_TYPE_TYPE_2: 'type2',
};

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) throw new Error('GOOGLE_MAPS_API_KEY is required (source .env.local first)');

const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'));
let cache = {};
try {
  cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
} catch {
  // First run.
}

const placeIds = [...new Set(index.hotels.map(hotel => hotel.ev.nearestCharger?.placeId).filter(Boolean))];
let fetched = 0;
for (const placeId of placeIds) {
  const cached = cache[placeId];
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) continue;
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
  });
  if (!response.ok) {
    console.warn(`Google Places ${placeId}: HTTP ${response.status} — keeping existing connector data`);
    continue;
  }
  const body = await response.json();
  const raw = [...new Set((body.evChargeOptions?.connectorAggregation ?? [])
    .map(item => item.type)
    .filter(Boolean))];
  const connectors = [...new Set(raw.map(type => GOOGLE_TO_FILTER[type]).filter(Boolean))];
  cache[placeId] = { raw, connectors, fetchedAt: new Date().toISOString() };
  fetched++;
  if (fetched % 25 === 0) console.log(`Fetched connector data for ${fetched} chargers`);
}

for (const hotel of index.hotels) {
  const charger = hotel.ev.nearestCharger;
  const data = charger?.placeId ? cache[charger.placeId] : null;
  charger.connectors = data?.connectors ?? [];
  charger.googleConnectorTypes = data?.raw ?? [];
  hotel.ev.connectorTypes = charger.connectors;
  hotel.ev.connectorSource = 'google_places_evChargeOptions';
}
index.connectorEnrichedAt = new Date().toISOString();

await fs.writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
const covered = index.hotels.filter(hotel => hotel.ev.connectorTypes?.length).length;
console.log(`Connector data: ${covered}/${index.hotels.length} hotels (${fetched} Google lookups, rest cached)`);
