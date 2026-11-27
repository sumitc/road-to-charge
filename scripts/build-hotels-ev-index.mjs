#!/usr/bin/env node
/**
 * LOCAL-ONLY: build a curated Hotels + EV seed index from real Google Places data.
 *
 * This script never runs in production and adds no serverless function. It reads
 * the existing local server-side GOOGLE_MAPS_API_KEY, reuses the existing
 * server/lib/googlePlaces.ts helper for area resolution, and calls Google Places
 * (New) directly from Node for lodging and charging stations. Requests are
 * sequential, throttled and cached in the OS temp directory for 30 days.
 *
 *   node scripts/build-hotels-ev-index.mjs
 *   node scripts/build-hotels-ev-index.mjs --area=jaipur --limit=2 --force
 *   node scripts/build-hotels-ev-index.mjs --photos --photo-cap=80
 *   node scripts/build-hotels-ev-index.mjs --validate
 *
 * No social reviews are requested or stored. PlugShare is never used.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGETS = path.join(ROOT, 'scripts/hotels-ev-targets.json');
const OFFICIAL_EVIDENCE = path.join(ROOT, 'scripts/hotels-official-evidence.json');
const OUT = path.join(ROOT, 'src/data/hotels-ev.index.generated.json');
const DISCOVERED = path.join(ROOT, 'src/data/hotels.discovered.json');
const PHOTO_DIR = path.join(ROOT, 'public/hotels/google');
const CACHE_DIR = path.join(os.tmpdir(), 'ampo-hotels-ev-index-cache-v1');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLACES_BASE = 'https://places.googleapis.com/v1';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
const opt = (name, fallback) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const limit = Math.max(1, Math.min(20, Number(opt('limit', '12')) || 12));
const radiusMeters = Math.max(500, Math.min(3000, Number(opt('radius', '2500')) || 2500));
const chargerLimit = Math.max(1, Math.min(20, Number(opt('chargers', '10')) || 10));
const delayMs = Math.max(0, Number(opt('delay', '250')) || 250);
const photoCap = Math.max(0, Number(opt('photo-cap', '80')) || 80);
const onlyArea = opt('area', '').toLowerCase();
const force = flags.has('--force');
const downloadPhotos = flags.has('--photos');
const dryRun = flags.has('--dry-run');
const validateOnly = flags.has('--validate');

const HOTEL_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.rating',
  'places.priceLevel',
  'places.types',
  'places.editorialSummary.text',
  'places.photos.name',
].join(',');

const CHARGER_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.googleMapsUri',
  'places.types',
].join(',');

const LODGING_TYPES = new Set([
  'lodging', 'hotel', 'resort_hotel', 'extended_stay_hotel', 'motel', 'guest_house',
  'bed_and_breakfast', 'private_guest_room', 'hostel', 'apartment_hotel', 'inn',
]);

const PRICE_LABELS = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '₹',
  PRICE_LEVEL_MODERATE: '₹₹',
  PRICE_LEVEL_EXPENSIVE: '₹₹₹',
  PRICE_LEVEL_VERY_EXPENSIVE: '₹₹₹₹',
};

const PROVIDERS = [
  [/tata\s*power|tata\s*ev/i, 'Tata Power'],
  [/jio[\s-]?bp/i, 'Jio-bp'],
  [/indian\s*oil|indiarioil|indioco|iocl/i, 'IndianOil'],
  [/bharat\s*petroleum|bharat\s*gas|bpcl/i, 'Bharat Petroleum'],
  [/hindustan\s*petroleum|hpcl/i, 'Hindustan Petroleum'],
  [/charge\s*zone/i, 'ChargeZone'],
  [/statiq/i, 'Statiq'],
  [/ather/i, 'Ather'],
  [/adani/i, 'Adani'],
  [/zeon/i, 'Zeon'],
  [/joule/i, 'Joule'],
  [/bright\s*blu/i, 'BrightBlu'],
  [/voltup/i, 'VoltUp'],
  [/ionix/i, 'IONIX'],
  [/exicom/i, 'Exicom'],
  [/fortum/i, 'Fortum'],
  [/shell\s*recharge|shell/i, 'Shell Recharge'],
  [/reliance/i, 'Reliance'],
  [/elasticsearch|ev\s*charge\s*network/i, 'EV charging network'],
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const normalizeName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Match a Google place to an exact, property-specific official EV claim.
 * Never use fuzzy/partial matching on generic words like "hotel": an on-site
 * claim needs the exact place ID or the property's full canonical name.
 */
function officialEvidenceFor(place, name, evidence) {
  const placeId = place?.id || '';
  const normalized = normalizeName(name);
  return evidence.entries.find(entry =>
    (entry.placeId && entry.placeId === placeId)
    || normalizeName(entry.name) === normalized
  ) || null;
}

const stats = {
  googleRequests: 0,
  cacheHits: 0,
  photoDownloads: 0,
  errors: [],
};

let lastRequestAt = 0;

async function pace() {
  const wait = lastRequestAt + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function readMapsKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY.trim();
  for (const file of ['.env.vercel', '.env.local', '.env']) {
    try {
      const contents = await fs.readFile(path.join(ROOT, file), 'utf8');
      for (const line of contents.split('\n')) {
        const match = line.match(/^GOOGLE_MAPS_API_KEY\s*=\s*(.*)$/);
        if (!match) continue;
        return match[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* optional file */ }
  }
  return '';
}

async function cachedJson(cacheKey, produce) {
  const file = path.join(CACHE_DIR, `${sha256(cacheKey)}.json`);
  if (!force) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Date.now() - Date.parse(parsed.fetchedAt) < CACHE_TTL_MS) {
        stats.cacheHits++;
        return parsed.data;
      }
    } catch { /* miss */ }
  }
  const data = await produce();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), data }));
  return data;
}

async function googlePost(endpoint, body, fieldMask, key) {
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    await pace();
    stats.googleRequests++;
    let response;
    try {
      response = await fetch(`${PLACES_BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      lastError = String(error);
      if (attempt === 0) { await sleep(1000); continue; }
      throw new Error(`${endpoint}: ${lastError}`);
    }
    if (response.ok) return response.json();
    const details = await response.json().catch(() => ({}));
    lastError = `HTTP ${response.status} ${details.error?.message || ''}`.trim();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await sleep(1500);
      continue;
    }
    throw new Error(`${endpoint}: ${lastError}`);
  }
  throw new Error(`${endpoint}: ${lastError}`);
}

function haversineMeters(a, b) {
  const lat1 = Number(a?.latitude);
  const lng1 = Number(a?.longitude);
  const lat2 = Number(b?.latitude);
  const lng2 = Number(b?.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function providerFromName(name) {
  for (const [pattern, label] of PROVIDERS) {
    if (pattern.test(name || '')) return label;
  }
  return 'Unlisted network';
}

function onSiteEvidence(place) {
  const text = [place.displayName?.text, place.editorialSummary?.text]
    .filter(Boolean).join(' — ');
  const match = text.match(/\b(?:ev|electric\s+(?:vehicle|car))\s+(?:charging|charger|charge)\b|\bcharger for electric\b/i);
  return match ? match[0] : null;
}

function mapsUrl(place, fallbackQuery) {
  if (place.googleMapsUri) return place.googleMapsUri;
  const query = fallbackQuery || place.displayName?.text || 'Google Maps';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function addressPart(place, types, fallback = '') {
  const component = place.addressComponents?.find(item =>
    item.types?.some(type => types.includes(type))
  );
  return component?.longText || component?.shortText || fallback;
}

async function maybeDownloadPhoto(photo, hotelId, name, key) {
  if (!downloadPhotos || !photo?.reference || stats.photoDownloads >= photoCap) return;
  const file = path.join(PHOTO_DIR, `${hotelId}.jpg`);
  try {
    await fs.access(file);
    photo.localPath = `/hotels/google/${hotelId}.jpg`;
    return;
  } catch { /* not cached yet */ }

  await pace();
  stats.googleRequests++;
  stats.photoDownloads++;
  try {
    const response = await fetch(`${PLACES_BASE}/${photo.reference}/media?maxWidthPx=640`, {
      headers: { 'X-Goog-Api-Key': key },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await fs.mkdir(PHOTO_DIR, { recursive: true });
    await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
    photo.localPath = `/hotels/google/${hotelId}.jpg`;
  } catch (error) {
    stats.errors.push(`photo ${hotelId}: ${String(error).slice(0, 120)}`);
  }
}

/**
 * Build one hotel row from a Google Place. Shared by the area sweep and by the
 * exact official-evidence pass so both use identical charger/evidence rules.
 */
async function buildHotel(place, area, { key, retrievedAt, officialEvidence }) {
  const placeId = place.id;
  const name = place.displayName?.text || '';
  if (!placeId || !name) return null;
  const position = place.location || {};
  const city = addressPart(place, ['locality', 'administrative_area_level_3'], area.city);
  const state = addressPart(place, ['administrative_area_level_1'], area.state);
  const locality = addressPart(place, ['sublocality_level_1', 'sublocality', 'neighborhood'], '');

  let chargerData;
  try {
    chargerData = await cachedJson(
      `searchNearby:v1:${Number(position.latitude).toFixed(5)},${Number(position.longitude).toFixed(5)}:${radiusMeters}:${chargerLimit}`,
      () => googlePost('places:searchNearby', {
        includedTypes: ['electric_vehicle_charging_station'],
        maxResultCount: chargerLimit,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: Number(position.latitude), longitude: Number(position.longitude) },
            radius: radiusMeters,
          },
        },
      }, CHARGER_MASK, key)
    );
  } catch (error) {
    stats.errors.push(`chargers ${placeId}: ${String(error).slice(0, 140)}`);
    chargerData = { places: [] };
  }

  const chargers = (chargerData.places || [])
    .map(charger => ({
      placeId: charger.id || '',
      name: charger.displayName?.text || 'EV charging station',
      provider: providerFromName(charger.displayName?.text),
      location: {
        lat: Number(charger.location?.latitude),
        lng: Number(charger.location?.longitude),
      },
      distanceMeters: haversineMeters(position, charger.location),
      sourceUrl: mapsUrl(charger),
    }))
    .filter(charger => charger.placeId && Number.isFinite(charger.distanceMeters) && charger.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const official = officialEvidenceFor(place, name, officialEvidence);
  const googleOnSite = onSiteEvidence(place);
  const onSiteText = official?.quote || googleOnSite;
  const nearest = chargers[0] || null;
  if (!onSiteText && !nearest) return null;

  const evSignal = onSiteText && nearest
    ? 'both'
    : onSiteText
      ? official ? 'on_site_official_source' : 'on_site_google_place'
      : 'ev_charger_nearby';
  const providers = [...new Set(chargers.map(charger => charger.provider))];
  const photo = place.photos?.[0]?.name ? {
    reference: place.photos[0].name,
    sourceUrl: mapsUrl(place, `${name}, ${city}, ${state}`),
    localPath: null,
  } : null;
  const hotelId = `google-${slug(placeId).slice(0, 48)}`;

  await maybeDownloadPhoto(photo, hotelId, name, key);

  const label = official
    ? nearest
      ? `EV charging confirmed by ${official.sourceName} · charger ${(nearest.distanceMeters / 1000).toFixed(1)} km away`
      : `EV charging confirmed by ${official.sourceName}`
    : googleOnSite && nearest
      ? `EV charging listed by Google · charger ${(nearest.distanceMeters / 1000).toFixed(1)} km away`
      : googleOnSite
        ? 'EV charging listed by Google Place'
        : `EV charger ${(nearest.distanceMeters / 1000).toFixed(1)} km away`;

  const sources = [{
    kind: 'google',
    label: 'Google Maps place',
    url: mapsUrl(place, `${name}, ${city}, ${state}`),
    verifiedAt: retrievedAt,
    verificationMethod: 'google_places_place_id',
  }];
  if (official) {
    sources.push({
      kind: 'hotel_website',
      label: official.sourceName,
      url: official.sourceUrl,
      verifiedAt: official.verifiedAt,
      verificationMethod: official.verificationMethod,
    });
  }

  return {
    id: hotelId,
    name,
    area: area.name,
    city,
    state,
    locality,
    formattedAddress: place.formattedAddress || '',
    location: { lat: Number(position.latitude), lng: Number(position.longitude) },
    interestTags: area.interestTags || [],
    rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
    priceBand: PRICE_LABELS[place.priceLevel] || null,
    source: official ? official.sourceName : 'Google Places API (New)',
    sourceUrl: mapsUrl(place, `${name}, ${city}, ${state}`),
    websiteUrl: place.websiteUri || official?.sourceUrl || null,
    photo,
    sources,
    evSignal,
    onSiteEvidence: onSiteText,
    onSiteEvidenceSource: official ? {
      label: official.sourceName,
      url: official.sourceUrl,
      quote: official.quote,
      verifiedAt: official.verifiedAt,
      verificationMethod: official.verificationMethod,
    } : googleOnSite ? {
      label: 'Google Places place details',
      url: mapsUrl(place, `${name}, ${city}, ${state}`),
      quote: googleOnSite,
      verifiedAt: retrievedAt,
      verificationMethod: 'google_places_place_id',
    } : null,
    ev: {
      label,
      nearestCharger: nearest,
      chargerCountWithinRadius: chargers.length,
      providers,
      radiusMeters,
    },
    provenance: {
      placeId,
      retrievedAt,
      hotelLookup: 'Google Places API (New) places:searchText',
      chargerLookup: 'Google Places API (New) places:searchNearby',
      demandUrl: area.demandUrl,
      coordinatesAsOf: retrievedAt,
    },
  };
}

async function collectArea(area, key, resolvePlaceByText, retrievedAt, officialEvidence) {
  const areaStats = { candidates: 0, indexed: 0, error: null };
  let resolved;
  try {
    resolved = await cachedJson(`resolve:v1:${area.query}`, async () => {
      await pace();
      stats.googleRequests++;
      const place = await resolvePlaceByText(area.query);
      if (!place) throw new Error('Google could not resolve the area query');
      return place;
    });
  } catch (error) {
    areaStats.error = String(error);
    stats.errors.push(`${area.id}: ${String(error).slice(0, 160)}`);
    return { area: { ...area, error: areaStats.error, placeId: null }, hotels: [], stats: areaStats };
  }

  const textQuery = `hotels in ${area.query}`;
  const maxResultCount = Math.min(20, limit * 3);
  const locationBias = {
    circle: {
      center: { latitude: resolved.lat, longitude: resolved.lng },
      radius: 15000,
    },
  };
  let hotelData;
  try {
    hotelData = await cachedJson(
      `searchText:v1:${textQuery}:${maxResultCount}:${resolved.lat.toFixed(4)},${resolved.lng.toFixed(4)}`,
      () => googlePost('places:searchText', { textQuery, maxResultCount, locationBias }, HOTEL_MASK, key)
    );
  } catch (error) {
    areaStats.error = String(error);
    stats.errors.push(`${area.id}: ${String(error).slice(0, 160)}`);
    return { area: { ...area, error: areaStats.error, placeId: resolved.placeId }, hotels: [], stats: areaStats };
  }

  const lodging = (hotelData.places || [])
    .filter(place => place.types?.some(type => LODGING_TYPES.has(type)))
    .slice(0, limit);
  areaStats.candidates = lodging.length;

  const hotels = [];
  for (const place of lodging) {
    const hotel = await buildHotel(place, area, { key, retrievedAt, officialEvidence });
    if (hotel) hotels.push(hotel);
  }

  areaStats.indexed = hotels.length;
  return {
    area: {
      ...area,
      placeId: resolved.placeId,
      coordinates: { lat: resolved.lat, lng: resolved.lng },
      resolvedLabel: resolved.label,
      candidates: areaStats.candidates,
      indexed: areaStats.indexed,
    },
    hotels,
    stats: areaStats,
  };
}

/**
 * Demand-discovered rows live in their own durable file so a fresh seed build
 * never wipes them. Merge by exact Google Place ID before writing the index;
 * build-seo-pages.mjs then emits detail shells and sitemap URLs for them too.
 */
async function mergeDiscoveredHotels(hotels, results) {
  let discovered;
  try {
    discovered = JSON.parse(await fs.readFile(DISCOVERED, 'utf8'));
  } catch {
    return { hotelsAdded: 0, areasAdded: 0 };
  }
  const seenPlaces = new Set(hotels.map(hotel => hotel.provenance?.placeId).filter(Boolean));
  let hotelsAdded = 0;
  for (const hotel of discovered.hotels ?? []) {
    const placeId = hotel.provenance?.placeId;
    if (!placeId || seenPlaces.has(placeId)) continue;
    seenPlaces.add(placeId);
    hotels.push(hotel);
    hotelsAdded++;
  }

  const seenAreaIds = new Set(results.map(area => area.id));
  const seenAreaNames = new Set(results.map(area =>
    `${area.name}|${area.city ?? ''}|${area.state ?? ''}`.toLowerCase()));
  let areasAdded = 0;
  for (const area of discovered.areas ?? []) {
    if (!area?.id || seenAreaIds.has(area.id)) continue;
    const key = `${area.name}|${area.city ?? ''}|${area.state ?? ''}`.toLowerCase();
    if (seenAreaNames.has(key)) continue;
    seenAreaIds.add(area.id);
    seenAreaNames.add(key);
    results.push(area);
    areasAdded++;
  }
  return { hotelsAdded, areasAdded };
}

function validate(index) {
  if (!Array.isArray(index.hotels) || !Array.isArray(index.areas)) throw new Error('missing hotels/areas arrays');
  const allowed = new Set(['on_site_google_place', 'on_site_official_source', 'ev_charger_nearby', 'both']);
  for (const hotel of index.hotels) {
    if (!allowed.has(hotel.evSignal)) throw new Error(`bad evSignal ${hotel.evSignal}`);
    if (!hotel.provenance?.placeId || !hotel.sourceUrl) throw new Error(`missing provenance ${hotel.id}`);
    if (hotel.ev?.nearestCharger && hotel.ev.nearestCharger.distanceMeters > hotel.ev.radiusMeters) {
      throw new Error(`charger outside radius ${hotel.id}`);
    }
    if (hotel.evSignal === 'ev_charger_nearby' && !hotel.ev?.nearestCharger) {
      throw new Error(`nearby signal without a charger ${hotel.id}`);
    }
    if ((hotel.evSignal === 'on_site_google_place' || hotel.evSignal === 'on_site_official_source' || hotel.evSignal === 'both') && !hotel.onSiteEvidence) {
      throw new Error(`on-site signal without source text ${hotel.id}`);
    }
    if (hotel.evSignal !== 'ev_charger_nearby' && !hotel.onSiteEvidenceSource?.url) {
      throw new Error(`on-site signal without source URL ${hotel.id}`);
    }
  }
  const scanKeys = value => {
    if (Array.isArray(value)) {
      for (const item of value) scanKeys(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:places\.)?reviews$/i.test(key)) throw new Error(`reviews field found in index: ${key}`);
      scanKeys(item);
    }
  };
  scanKeys(index);
  return true;
}

async function main() {
  if (validateOnly) {
    const index = JSON.parse(await fs.readFile(OUT, 'utf8'));
    validate(index);
    console.log(`Validated ${index.hotels.length} hotels across ${index.areas.length} areas: ${OUT}`);
    return;
  }

  const key = await readMapsKey();
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY not found in env or local env files');
  // The helper reads process.env at call time; expose the local server-side key to it.
  process.env.GOOGLE_MAPS_API_KEY = key;

  // Node 24 strips TypeScript types; this is the same helper used by /api/stations.
  const { searchPlaceByText } = await import('../server/lib/googlePlaces.ts');
  const targets = JSON.parse(await fs.readFile(TARGETS, 'utf8'));
  const officialEvidence = JSON.parse(await fs.readFile(OFFICIAL_EVIDENCE, 'utf8'));
  const areas = onlyArea
    ? targets.areas.filter(area => area.id === onlyArea || slug(area.name) === onlyArea)
    : targets.areas;
  if (!areas.length) throw new Error(`No target matched --area=${onlyArea}`);

  const retrievedAt = new Date().toISOString();
  const results = [];
  const hotels = [];
  console.log(`Building local Hotels EV index: ${areas.length} areas, ${limit} hotels/area, ${radiusMeters} m radius`);

  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const result = await collectArea(area, key, searchPlaceByText, retrievedAt, officialEvidence);
    results.push(result.area);
    hotels.push(...result.hotels);
    console.log(`[${i + 1}/${areas.length}] ${area.name}: ${result.hotels.length}/${result.stats.candidates} indexed${result.stats.error ? ` — ${result.stats.error.slice(0, 90)}` : ''}`);
  }

  // Exact official properties that Google's area search did not surface still
  // belong in the index when their own site confirms on-site charging.
  let officialAdded = 0;
  for (const entry of officialEvidence.entries) {
    if (!entry.searchQuery || onlyArea) continue;
    const already = hotels.some(hotel =>
      (entry.placeId && hotel.provenance.placeId === entry.placeId)
      || normalizeName(hotel.name) === normalizeName(entry.name)
    );
    if (already) continue;
    const area = targets.areas.find(item => item.id === entry.areaId) || {
      id: 'official', name: entry.name, city: '', state: '', interestTags: [], demandUrl: null,
    };
    const resolvedArea = results.find(item => item.id === area.id);
    const body = { textQuery: entry.searchQuery, maxResultCount: 1 };
    if (resolvedArea?.coordinates) {
      body.locationBias = {
        circle: {
          center: {
            latitude: resolvedArea.coordinates.lat,
            longitude: resolvedArea.coordinates.lng,
          },
          radius: 15000,
        },
      };
    }
    let placeData;
    try {
      placeData = await cachedJson(
        `officialPlace:v2:${entry.searchQuery}`,
        () => googlePost('places:searchText', body, HOTEL_MASK, key)
      );
    } catch (error) {
      stats.errors.push(`official ${entry.id}: ${String(error).slice(0, 140)}`);
      continue;
    }
    const place = (placeData.places || []).find(item =>
      item.types?.some(type => LODGING_TYPES.has(type))
    ) || placeData.places?.[0];
    if (!place) {
      stats.errors.push(`official ${entry.id}: Google returned no place`);
      continue;
    }
    const matched = officialEvidenceFor(place, place.displayName?.text || entry.name, officialEvidence);
    if (!matched || matched.id !== entry.id) {
      stats.errors.push(`official ${entry.id}: Google place did not match the official property name`);
      continue;
    }
    const hotel = await buildHotel(place, area, { key, retrievedAt, officialEvidence });
    if (hotel) {
      hotels.push(hotel);
      if (resolvedArea) resolvedArea.indexed = (resolvedArea.indexed || 0) + 1;
      officialAdded++;
    }
  }

  const discoveryMerge = await mergeDiscoveredHotels(hotels, results);

  const evSignalCounts = {};
  const providers = new Set();
  const priceBands = new Set();
  for (const hotel of hotels) {
    evSignalCounts[hotel.evSignal] = (evSignalCounts[hotel.evSignal] || 0) + 1;
    if (hotel.priceBand) priceBands.add(hotel.priceBand);
    for (const provider of hotel.ev.providers || []) providers.add(provider);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    indexVersion: 2,
    method: {
      source: 'Google Places API (New) + official hotel/brand pages',
      hotels: `places:searchText with a 15 km location bias; lodging types only; up to ${limit} per curated area`,
      chargers: `places:searchNearby includedTypes=electric_vehicle_charging_station within ${radiusMeters} m`,
      areaResolution: 'existing server/lib/googlePlaces.ts searchPlaceByText helper',
      onSiteEvidence: 'Exact property-specific official page quote, or Google place name/summary. Never proximity alone.',
      radiusMeters,
      perAreaLimit: limit,
      chargersPerHotel: chargerLimit,
      demandSource: targets.demandSource,
      demandCheckedOn: targets.reviewedOn,
      officialEvidenceCheckedOn: officialEvidence.reviewedOn,
      cacheTtlDays: 30,
      demandDiscovery: 'Demand-driven Google lodging results are merged from src/data/hotels.discovered.json by exact Place ID.',
      note: 'Curated seed plus demand-discovered rows. Proximity stays "Charger nearby"; only sourced text can claim on-site EV charging. No social reviews are collected.',
    },
    coverage: {
      areasRequested: areas.length,
      areasResolved: results.filter(area => area.placeId).length,
      candidateHotels: results.reduce((sum, area) => sum + (area.candidates || 0), 0),
      hotelsIndexed: hotels.length,
      officialEvidenceEntries: officialEvidence.entries.length,
      officialExactAdditions: officialAdded,
      discoveredHotels: discoveryMerge.hotelsAdded,
      discoveredAreas: discoveryMerge.areasAdded,
      evSignalCounts,
      providers: [...providers].sort(),
      priceBands: [...priceBands].sort(),
      googleRequests: stats.googleRequests,
      cacheHits: stats.cacheHits,
      photoDownloads: stats.photoDownloads,
      errors: stats.errors,
    },
    areas: results,
    hotels,
  };

  validate(index);
  if (!dryRun) {
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, `${JSON.stringify(index, null, 2)}\n`);
    console.log(`Wrote ${hotels.length} hotels across ${results.length} areas to ${path.relative(ROOT, OUT)}`);
  } else {
    console.log(`Dry run: ${hotels.length} hotels across ${results.length} areas (no file written)`);
  }
  console.log(`Google calls: ${stats.googleRequests}; cache hits: ${stats.cacheHits}; photo downloads: ${stats.photoDownloads}; official exact additions: ${officialAdded}`);
}

main().catch(error => { console.error(error); process.exit(1); });
