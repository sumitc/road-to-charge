/**
 * One-off repair for BEE rows whose station_name/address arrived mojibaked
 * (broken upstream font ToUnicode mapping — common charset round-trips cannot
 * recover the original text). Instead of guessing a decoder, look the station
 * up by its real coordinates with Google Places (New) and replace only the
 * garbled name/address with Google's canonical display name/address.
 *
 * Dry-run by default: writes a review report and changes nothing in the DB.
 * Pass --apply only after reviewing the report. Writes are sequential: the
 * station trigger clears enrichment when a name/address changes, so the place
 * id is written in a second UPDATE (never in the same statement).
 */
import fs from 'node:fs';
import postgres from 'postgres';

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

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY missing from env');
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) throw new Error('POSTGRES_URL_NON_POOLING missing from env');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const limitArg = [...args].find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
// Conservative: only accept a Google place that is essentially at the
// catalogued coordinates. Farther matches are more likely a different site.
const MAX_DISTANCE_KM = 0.1;

const isGarbled = s => /[^\x20-\x7E]/.test(s ?? '') || /[\x00-\x1F]/.test(s ?? '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchPlaces(textQuery, lat, lng) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName.text',
        'places.formattedAddress',
        'places.location.latitude',
        'places.location.longitude',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 1000 } },
      maxResultCount: 10,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Google Places ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.json();
  return data.places ?? [];
}

const PROVIDER_TOKENS = {
  'Tata Power': 'tata',
  'Reliance BP': 'reliance|jio bp',
  IOCL: 'indian oil|iocl',
  BPCL: 'bharat petroleum|bpcl',
  HPCL: 'hindustan petroleum|hpcl',
  Ather: 'ather',
  Joule: 'joule',
};

function providerToken(provider) {
  return PROVIDER_TOKENS[provider] ?? (provider ?? '').toLowerCase();
}

/** Reject a near match that is explicitly branded for a different operator. */
function isOtherProvider(label, provider) {
  return Object.entries(PROVIDER_TOKENS).some(([name, token]) => {
    if (name === provider) return false;
    if (!token) return false;
    return new RegExp(`\\b(?:${token})\\b`, 'i').test(label);
  });
}

function pickCandidate(places, station) {
  const lat = Number(station.latitude);
  const lng = Number(station.longitude);
  const token = providerToken(station.provider);
  const tokenRe = token ? new RegExp(token, 'i') : null;
  const seen = new Set();
  const candidates = [];
  for (const place of places) {
    if (!place.id || !place.displayName?.text || !Number.isFinite(place.location?.latitude)) continue;
    const label = `${place.displayName.text} ${place.formattedAddress ?? ''}`;
    if (seen.has(place.id) || isGarbled(place.displayName.text) || isGarbled(place.formattedAddress)) continue;
    if (isOtherProvider(label, station.provider)) continue;
    seen.add(place.id);
    const distanceKm = haversineKm(lat, lng, place.location.latitude, place.location.longitude);
    if (distanceKm > MAX_DISTANCE_KM) continue;
    candidates.push({
      placeId: place.id,
      name: place.displayName.text,
      address: place.formattedAddress ?? '',
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      providerMatch: Boolean(tokenRe?.test(label)),
    });
  }
  candidates.sort((a, b) =>
    Number(b.providerMatch) - Number(a.providerMatch) || a.distanceKm - b.distanceKm);
  return candidates[0] ?? null;
}

const reportArg = [...args].find(a => a.startsWith('--report='));
const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 });

async function applyEntry(entry, candidate) {
  // Trigger clears enrichment on name/address change; restore the place id in
  // a separate statement and keep coordinates exactly as catalogued.
  await sql`UPDATE public.ev_charging_stations
            SET station_name = ${candidate.name}, address = ${candidate.address}
            WHERE id = ${entry.id}`;
  await sql`UPDATE public.ev_charging_stations
            SET google_place_id = ${candidate.placeId}
            WHERE id = ${entry.id}`;
  entry.applied = true;
}

if (reportArg) {
  // Apply an already-reviewed dry-run report without spending more Google
  // lookups. Entries marked unresolved are skipped.
  const reviewed = JSON.parse(fs.readFileSync(reportArg.split('=')[1], 'utf8'));
  let applied = 0;
  for (const entry of reviewed) {
    if (entry.unresolved || !entry.placeId || !entry.name || !entry.address) continue;
    await applyEntry(entry, entry);
    applied++;
    console.log(`${String(applied).padStart(3)} ${entry.name} — ${entry.beforeName?.slice(0, 40)}`);
  }
  await sql.end();
  const out = '/private/var/folders/04/3dn3shdx7xz2f9tn_q8g0p0r0000gn/T/opencode/ampo-garble-repair-applied.json';
  fs.writeFileSync(out, JSON.stringify(reviewed, null, 2));
  console.log(`Applied ${applied} reviewed repairs. Report: ${out}`);
  process.exit(0);
}

const rows = await sql`
  SELECT id, station_name, address, provider, city, latitude, longitude,
         google_place_id, source_name
  FROM public.ev_charging_stations
  WHERE station_name ~ '[^\\x20-\\x7E]' OR station_name ~ '[\\x00-\\x1F]'
     OR address ~ '[^\\x20-\\x7E]' OR address ~ '[\\x00-\\x1F]'
  ORDER BY station_name
`;
console.log(`Found ${rows.length} garbled rows; processing ${Math.min(rows.length, limit)}`);

const report = [];
for (const station of rows.slice(0, limit)) {
  const queries = [
    `${station.provider ?? ''} EV charging station`.trim(),
    'EV charging station',
  ];
  let candidate = null;
  let error = null;
  for (const query of queries) {
    try {
      const places = await searchPlaces(query, Number(station.latitude), Number(station.longitude));
      candidate = pickCandidate(places, station);
      if (candidate) break;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await sleep(120);
  }
  const entry = {
    id: station.id,
    provider: station.provider,
    beforeName: station.station_name,
    beforeAddress: station.address,
    lat: Number(station.latitude),
    lng: Number(station.longitude),
    oldPlaceId: station.google_place_id,
    source: station.source_name,
    ...(candidate ?? { unresolved: true, error }),
  };
  if (candidate && apply) await applyEntry(entry, candidate);
  report.push(entry);
  console.log(`${String(report.length).padStart(3)}/${Math.min(rows.length, limit)} `
    + `${candidate ? `${candidate.distanceKm} km ${candidate.name}` : `UNRESOLVED ${error ?? 'no nearby place'}`}`);
  await sleep(100);
}

await sql.end();
const out = `/private/var/folders/04/3dn3shdx7xz2f9tn_q8g0p0r0000gn/T/opencode/ampo-garble-repair${apply ? '-applied' : '-dry-run'}.json`;
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n${report.filter(r => !r.unresolved).length}/${report.length} repaired candidates`
  + ` (${report.filter(r => r.unresolved).length} unresolved). Report: ${out}`);
