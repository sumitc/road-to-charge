#!/usr/bin/env node
/**
 * LOCAL-ONLY: enrich the generated hotel EV index with chargers from every
 * source Ampo already trusts. This does NOT change on-site claims: a charger
 * anywhere near a hotel stays "Charger nearby" unless an official property
 * source explicitly confirms on-site charging (handled by the builder).
 *
 * Sources:
 *   1. Ampo station DB (BEE / Google Places catalog / community submissions)
 *   2. OpenStreetMap Overpass (keyless, rate-limited, cached)
 *   3. Open Charge Map (needs OPEN_CHARGE_MAP_API_KEY; optional)
 *   Google Places nearby chargers are already in the generated index.
 *
 *   source .env.local
 *   node scripts/enrich-hotels-all-sources.mjs
 *   node scripts/enrich-hotels-all-sources.mjs --skip-osm --skip-ocm --dry-run
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const INDEX_PATH = path.join(ROOT, 'src/data/hotels-ev.index.generated.json');
const CACHE_DIR = path.join(os.tmpdir(), 'ampo-hotels-multisource-cache-v1');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
const opt = (name, fallback) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const radiusMeters = Math.max(250, Math.min(5000, Number(opt('radius', '2500')) || 2500));
const maxSourcesPerHotel = Math.max(1, Math.min(20, Number(opt('limit', '10')) || 10));
const skipOsm = flags.has('--skip-osm');
const skipOcm = flags.has('--skip-ocm');
const dryRun = flags.has('--dry-run');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const genericWords = new Set(['hotel', 'resort', 'inn', 'lodge', 'guest', 'house', 'the', 'by', 'and']);

async function readEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const file of ['.env.local', '.env']) {
    try {
      const contents = await fs.readFile(path.join(ROOT, file), 'utf8');
      const match = contents.split('\n').find(line => line.startsWith(`${name}=`));
      if (match) return match.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch { /* optional */ }
  }
  return '';
}

async function cachedJson(cacheKey, produce) {
  const file = path.join(CACHE_DIR, `${sha256(cacheKey)}.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Date.now() - Date.parse(parsed.fetchedAt) < CACHE_TTL_MS) return parsed.data;
  } catch { /* miss */ }
  const data = await produce();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), data }));
  return data;
}

function haversineMeters(a, b) {
  const lat1 = Number(a?.lat ?? a?.latitude);
  const lng1 = Number(a?.lng ?? a?.longitude);
  const lat2 = Number(b?.lat ?? b?.latitude);
  const lng2 = Number(b?.lng ?? b?.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function canonicalConnectors(values) {
  const text = (Array.isArray(values) ? values : [values]).filter(Boolean).join(' ').toLowerCase();
  const found = [];
  if (/ccs|combo/.test(text)) found.push('ccs');
  if (/chademo/.test(text)) found.push('chademo');
  if (/bharat\s*dc|dc001/.test(text)) found.push('bharatDc');
  if (/bharat\s*ac|ac001/.test(text)) found.push('bharatAc');
  if (/type\s*2|type2|mennekes|j1772|type\s*1/.test(text)) found.push('type2');
  return [...new Set(found)];
}

/** Does a charger row's own text name this property? Never an on-site claim. */
function mentionsHotel(text, hotelName) {
  const tokens = normalize(hotelName).split(' ').filter(token => token.length > 3 && !genericWords.has(token));
  if (!tokens.length) return false;
  const haystack = normalize(text);
  const hits = tokens.filter(token => haystack.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

async function fetchDbChargers() {
  const url = await readEnv('POSTGRES_URL');
  if (!url) throw new Error('POSTGRES_URL is required');
  const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });
  try {
    const rows = await sql`
      SELECT id::text AS id, station_name, address, provider,
             latitude::float8 AS lat, longitude::float8 AS lng,
             connector_types, source_name
      FROM public.ev_charging_stations
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `;
    return rows.map(row => ({
      source: row.source_name || 'Ampo station DB',
      sourceKind: 'db',
      id: row.id,
      name: row.station_name,
      provider: row.provider || 'Unlisted network',
      lat: row.lat,
      lng: row.lng,
      sourceUrl: `https://ampo.vercel.app/station/${row.id}`,
      connectorValues: row.connector_types,
      text: [row.station_name, row.address].filter(Boolean).join(' — '),
    }));
  } finally {
    await sql.end();
  }
}

async function fetchOsmChargers(areas) {
  const endpoints = (await readEnv('OVERPASS_API_URL'))
    ? [await readEnv('OVERPASS_API_URL')]
    : ['https://overpass.osm.ch/api/interpreter', 'https://overpass-api.de/api/interpreter'];
  const output = [];
  for (const area of areas) {
    const point = area.coordinates;
    if (!point) continue;
    const data = await cachedJson(`osm:v2:${radiusMeters}:${area.id}:${point.lat}:${point.lng}`, async () => {
      const query = `[out:json][timeout:25];nwr[amenity=charging_station](around:${radiusMeters},${point.lat},${point.lng});out center tags;`;
      let lastError;
      for (const endpoint of endpoints) {
        await sleep(1100);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'AmpoHotelIndex/1.0 (local data research)',
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(40000),
          });
          if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    });
    for (const element of data.elements || []) {
      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon;
      if (![lat, lng].every(Number.isFinite)) continue;
      const tags = element.tags || {};
      const connectorValues = Object.entries(tags)
        .filter(([key, value]) => key.startsWith('socket:') && value === 'yes')
        .map(([key]) => key.slice(7));
      output.push({
        source: 'OpenStreetMap',
        sourceKind: 'osm',
        id: `${element.type}-${element.id}`,
        name: tags.name || 'Charging station (OSM)',
        provider: tags.operator || 'Unlisted network',
        lat,
        lng,
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        connectorValues,
        text: [tags.name, tags.operator, tags.addr_full, tags.addr_street].filter(Boolean).join(' — '),
      });
    }
  }
  return output;
}

async function fetchOcmChargers() {
  const key = await readEnv('OPEN_CHARGE_MAP_API_KEY');
  if (!key) return { chargers: [], skipped: 'no OPEN_CHARGE_MAP_API_KEY' };
  const data = await cachedJson(`ocm:in:${key.slice(-6)}`, async () => {
    const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=IN&maxresults=2000&compact=true&verbose=false&key=${encodeURIComponent(key)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`OCM HTTP ${response.status}`);
    return response.json();
  });
  const chargers = (Array.isArray(data) ? data : []).map(station => ({
    source: 'Open Charge Map',
    sourceKind: 'ocm',
    id: String(station.ID ?? station.AddressInfo?.ID ?? ''),
    name: station.AddressInfo?.Title || 'Charging station (OCM)',
    provider: station.OperatorInfo?.Title || 'Unlisted network',
    lat: Number(station.AddressInfo?.Latitude),
    lng: Number(station.AddressInfo?.Longitude),
    sourceUrl: `https://openchargemap.org/site/poi/details/${station.ID}`,
    connectorValues: (station.Connections || []).map(connection => connection.ConnectionType?.Title),
    text: [station.AddressInfo?.Title, station.AddressInfo?.AddressLine1].filter(Boolean).join(' — '),
  })).filter(charger => charger.id && [charger.lat, charger.lng].every(Number.isFinite));
  return { chargers, skipped: null };
}

function toCharger(candidate, hotelPoint) {
  return {
    placeId: candidate.sourceKind === 'google' ? candidate.id : '',
    source: candidate.source,
    sourceKind: candidate.sourceKind,
    name: candidate.name,
    provider: candidate.provider,
    location: { lat: candidate.lat, lng: candidate.lng },
    distanceMeters: haversineMeters(hotelPoint, candidate),
    sourceUrl: candidate.sourceUrl,
    mentionsHotel: mentionsHotel(candidate.text, candidate.hotelName),
    connectors: canonicalConnectors(candidate.connectorValues),
  };
}

async function main() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'));
  const errors = [];
  const [dbChargers, ocmResult] = await Promise.all([
    fetchDbChargers(),
    skipOcm ? Promise.resolve({ chargers: [], skipped: 'skipped by flag' }) : fetchOcmChargers().catch(error => ({
      chargers: [], skipped: String(error),
    })),
  ]);
  const osmChargers = skipOsm ? [] : await fetchOsmChargers(index.areas || []).catch(error => {
    errors.push(`OSM: ${String(error).slice(0, 160)}`);
    return [];
  });
  const allSources = [...dbChargers, ...osmChargers, ...ocmResult.chargers];
  console.log(`Source rows: DB=${dbChargers.length} OSM=${osmChargers.length} OCM=${ocmResult.chargers.length}`
    + `${ocmResult.skipped ? ` (OCM skipped: ${ocmResult.skipped})` : ''}`);

  const sourceCounts = {};
  let nearestChanged = 0;
  for (const hotel of index.hotels) {
    const point = hotel.location;
    const googleRows = [
      ...(hotel.ev.nearbyChargerSources || []),
      ...(hotel.ev.nearestCharger ? [hotel.ev.nearestCharger] : []),
    ].filter(charger => charger?.location && Number.isFinite(charger.location.lat));
    const googleCandidates = googleRows.map(charger => ({
      source: 'Google Places API (New)',
      sourceKind: 'google',
      id: charger.placeId || '',
      name: charger.name,
      provider: charger.provider,
      lat: charger.location.lat,
      lng: charger.location.lng,
      sourceUrl: charger.sourceUrl,
      connectorValues: charger.connectors || [],
      text: charger.name,
    }));
    const nearby = [...googleCandidates, ...allSources]
      .map(candidate => ({
        ...candidate,
        hotelName: hotel.name,
        distanceMeters: haversineMeters(point, candidate),
      }))
      .filter(charger => Number.isFinite(charger.distanceMeters) && charger.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .filter((candidate, index, list) => list.findIndex(other =>
        other.sourceKind === candidate.sourceKind && other.id === candidate.id
      ) === index)
      .map(candidate => toCharger(candidate, point));
    for (const charger of nearby) sourceCounts[charger.sourceKind] = (sourceCounts[charger.sourceKind] || 0) + 1;

    hotel.ev.nearbyChargerSources = nearby.slice(0, maxSourcesPerHotel);
    const current = hotel.ev.nearestCharger;
    const best = nearby[0];
    if (best && (!current || best.distanceMeters < current.distanceMeters)) {
      hotel.ev.nearestCharger = best;
      hotel.ev.label = hotel.onSiteEvidence
        ? hotel.ev.label
        : `EV charger ${(best.distanceMeters / 1000).toFixed(1)} km away`;
      nearestChanged++;
    }
    const union = new Set(hotel.ev.connectorTypes || []);
    for (const charger of nearby) for (const connector of charger.connectors || []) union.add(connector);
    hotel.ev.connectorTypes = [...union];
    hotel.ev.connectorSource = 'google_places_evChargeOptions + osm + db + ocm';
  }

  index.multiSourceEnrichedAt = new Date().toISOString();
  index.coverage.chargerSourceRows = sourceCounts;
  index.coverage.multiSourceErrors = errors;
  if (!dryRun) await fs.writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`${dryRun ? 'Dry run: ' : 'Wrote '}${index.hotels.length} hotels; nearest charger changed for ${nearestChanged}; source counts ${JSON.stringify(sourceCounts)}`);
}

main().catch(error => { console.error(error); process.exit(1); });
