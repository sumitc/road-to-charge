#!/usr/bin/env node
/**
 * LOCAL-ONLY: drain the demand queue written by /api/stations?mode=discover-hotel.
 *
 * Each queued anchor is a real Google place the Hotels tab could not find in
 * our generated index. This script sweeps up to 20 real lodging places within
 * 10 km of that anchor, keeps only rows with property-specific on-site text or
 * a real public charger within 2.5 km, and merges them by exact Place ID into
 * src/data/hotels.discovered.json. `build-hotels-ev-index.mjs` then merges that
 * file into the generated index on the next local build/deploy, which adds
 * static hotel shells and sitemap URLs. No PlugShare, OTA scraping, invented
 * ratings, guessed URLs or guessed on-site claims.
 *
 *   node scripts/discover-hotels-from-queue.mjs
 *   node scripts/discover-hotels-from-queue.mjs --dry-run
 *   node scripts/discover-hotels-from-queue.mjs --max=3 --delay=500
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { del, get, list } from '@vercel/blob';
import { discoverNearbyHotels } from '../server/lib/hotelDiscovery.ts';
import { HOTEL_DISCOVERY_QUEUE_PREFIX } from '../server/lib/hotelDiscoveryQueue.ts';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'src/data/hotels.discovered.json');
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
const opt = (name, fallback) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dryRun = flags.has('--dry-run');
const maxAnchors = Math.max(1, Math.min(50, Number(opt('max', '10')) || 10));
const delayMs = Math.max(0, Number(opt('delay', '350')) || 350);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const slug = value => String(value || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'place';

async function loadLocalEnv() {
  const names = ['GOOGLE_MAPS_API_KEY', 'BLOB_READ_WRITE_TOKEN'];
  for (const file of ['.env.vercel', '.env.local', '.env']) {
    let contents;
    try {
      contents = await fs.readFile(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of contents.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match || !names.includes(match[1]) || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function listQueue(token) {
  const blobs = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const result = await list({
      prefix: HOTEL_DISCOVERY_QUEUE_PREFIX,
      limit: 100,
      cursor,
      token,
    });
    blobs.push(...result.blobs);
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return blobs;
}

function parseQueueItem(raw) {
  let item;
  try {
    item = JSON.parse(raw);
  } catch {
    return null;
  }
  if (item?.schema !== 1 || item?.surface !== 'hotels') return null;
  const placeId = typeof item.placeId === 'string' && PLACE_ID_RE.test(item.placeId)
    ? item.placeId : '';
  const query = typeof item.query === 'string' ? item.query.trim() : '';
  if (!placeId && query.length < 3) return null;
  const lat = Number(item.location?.lat);
  const lng = Number(item.location?.lng);
  if (![lat, lng].every(Number.isFinite)) return null;
  return {
    placeId: placeId || undefined,
    query: query || undefined,
    label: String(item.label || query || placeId || 'Google place').slice(0, 180),
    location: { lat, lng },
    reason: String(item.reason || ''),
    queuedAt: String(item.queuedAt || ''),
  };
}

function anchorKey(anchor) {
  return anchor.placeId
    || `${anchor.label.toLowerCase()}|${anchor.location.lat.toFixed(4)},${anchor.location.lng.toFixed(4)}`;
}

async function main() {
  await loadLocalEnv();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required to read the hotel demand queue');
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is required for the nearby hotel sweep');

  const blobs = await listQueue(token);
  const anchors = [];
  const seen = new Set();
  let invalid = 0;
  for (const blob of blobs) {
    let item = null;
    try {
      const result = await get(blob.pathname, { access: 'public', token, useCache: false });
      if (result.statusCode === 200) {
        item = parseQueueItem(await new Response(result.stream).text());
      }
    } catch (error) {
      console.warn(`[hotel-discovery] could not read ${blob.pathname}: ${String(error).slice(0, 120)}`);
      continue;
    }
    if (!item) {
      invalid += 1;
      continue;
    }
    const key = anchorKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push({ blob, item });
  }

  console.log(`[hotel-discovery] queue has ${blobs.length} object(s), ${anchors.length} unique anchor(s), ${invalid} invalid`);
  if (!anchors.length) return;

  const selected = anchors.slice(0, maxAnchors);
  const existing = await readJson(OUT, {
    schemaVersion: 1,
    generatedAt: null,
    hotels: [],
    areas: [],
  });
  const knownPlaces = new Set((existing.hotels || [])
    .map(hotel => hotel.provenance?.placeId).filter(Boolean));
  const knownAreaPlaces = new Set((existing.areas || [])
    .map(area => area.placeId).filter(Boolean));
  const newHotels = [];
  const newAreas = [];
  const processedBlobs = [];
  let sweepCalls = 0;

  for (const { blob, item } of selected) {
    console.log(`[hotel-discovery] sweeping ${item.label} (${item.placeId || item.query})`);
    const result = await discoverNearbyHotels(item, apiKey, { delayMs });
    sweepCalls += 1;
    if (!result.anchor) {
      console.warn('[hotel-discovery] anchor could not be resolved; keeping it queued');
      continue;
    }

    let keptForAnchor = 0;
    for (const hotel of result.hotels) {
      const placeId = hotel.provenance?.placeId;
      if (!placeId || knownPlaces.has(placeId)) continue;
      knownPlaces.add(placeId);
      newHotels.push(hotel);
      keptForAnchor += 1;
    }
    const representative = result.hotels[0];
    const areaPlaceId = result.anchor.placeId;
    if (representative && areaPlaceId && !knownAreaPlaces.has(areaPlaceId)) {
      knownAreaPlaces.add(areaPlaceId);
      newAreas.push({
        id: `discovered-${slug(result.anchor.label)}-${areaPlaceId.slice(-6)}`,
        name: result.anchor.label,
        city: representative.city || '',
        state: representative.state || '',
        placeId: areaPlaceId,
        coordinates: result.anchor.location,
        demandUrl: `https://www.google.com/maps/place/?q=place_id:${areaPlaceId}`,
        interestTags: [],
      });
    }
    console.log(`[hotel-discovery] kept ${keptForAnchor} of ${result.hotels.length} real lodging row(s)`);
    processedBlobs.push(blob);
    await sleep(delayMs);
  }

  console.log(`[hotel-discovery] ${newHotels.length} new hotel(s), ${newAreas.length} new area(s) from ${sweepCalls} sweep(s)`);
  if (dryRun) {
    console.log('[hotel-discovery] dry run: no file written and no queue objects deleted');
    return;
  }

  if (newHotels.length || newAreas.length) {
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, `${JSON.stringify({
      ...existing,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      lastQueueRun: {
        at: new Date().toISOString(),
        anchorsProcessed: processedBlobs.length,
        hotelsAdded: newHotels.length,
        scope: { hotelLimit: 20, radiusKm: 10, chargerRadiusKm: 2.5 },
      },
      hotels: [...(existing.hotels || []), ...newHotels],
      areas: [...(existing.areas || []), ...newAreas],
    }, null, 2)}\n`);
    console.log(`[hotel-discovery] wrote ${path.relative(ROOT, OUT)}`);
  }

  if (processedBlobs.length) {
    await del(processedBlobs.map(blob => blob.url), { token });
    console.log(`[hotel-discovery] removed ${processedBlobs.length} processed queue object(s)`);
  }
  const left = anchors.length - processedBlobs.length;
  if (left > 0) console.log(`[hotel-discovery] ${left} anchor(s) remain queued for the next run`);
  console.log('[hotel-discovery] next: node scripts/build-hotels-ev-index.mjs && npm run seo:build');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
