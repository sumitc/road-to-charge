/**
 * Demand-driven hotel discovery for the Hotels tab.
 *
 * The curated hotel index is a point-in-time seed. A user can still pick a
 * real lodging place from Google autocomplete that is not in that seed. This
 * helper verifies the exact Place ID, reads real Google Places details and
 * nearby public chargers, and returns the same `Hotel` shape the UI already
 * uses. No PlugShare, OTA scraping, copied reviews or guessed on-site claims.
 *
 * Lives in server/lib so /api/stations can call it without adding a Vercel
 * function (Hobby function limit).
 */
import type { Charger, Hotel } from '../src/lib/hotelIndex.js';

const PLACES_BASE = 'https://places.googleapis.com/v1';
const RADIUS_METERS = 2500;
const CHARGER_LIMIT = 10;
/** Bounded demand sweep: 20 lodgings within 10 km, matching the queued growth plan. */
export const NEARBY_HOTEL_RADIUS_METERS = 10000;
export const NEARBY_HOTEL_LIMIT = 20;

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
  'places.location',
  'places.googleMapsUri',
  'places.types',
].join(',');

const LODGING_TYPES = new Set([
  'lodging', 'hotel', 'resort_hotel', 'extended_stay_hotel', 'motel', 'guest_house',
  'bed_and_breakfast', 'private_guest_room', 'hostel', 'apartment_hotel', 'inn',
]);

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

const PRICE_LABELS: Record<string, string> = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '₹',
  PRICE_LEVEL_MODERATE: '₹₹',
  PRICE_LEVEL_EXPENSIVE: '₹₹₹',
  PRICE_LEVEL_VERY_EXPENSIVE: '₹₹₹₹',
};

const PROVIDER_PATTERNS: Array<[RegExp, string]> = [
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
  [/bright\s*blu/i, 'BrightBlu'],
  [/exicom/i, 'Exicom'],
  [/shell\s*recharge/i, 'Shell Recharge'],
];

const CONNECTOR_PATTERNS: Array<[RegExp, string]> = [
  [/ccs|combo\s*[12]/i, 'ccs'],
  [/chademo/i, 'chademo'],
  [/bharat\s*dc|dc001/i, 'bharatDc'],
  [/bharat\s*ac|ac001/i, 'bharatAc'],
  [/type\s*[12]|mennekes|j1772/i, 'type2'],
];

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  websiteUri?: string;
  rating?: number;
  priceLevel?: string;
  types?: string[];
  editorialSummary?: { text?: string };
  photos?: Array<{ name?: string }>;
};

export type HotelDiscoveryAnchor = {
  placeId?: string;
  label: string;
  query?: string;
  location: { lat: number; lng: number };
};

export type HotelDiscoveryResult = {
  hotel: Hotel | null;
  reason?: 'not_lodging' | 'no_ev_data' | 'not_configured' | 'failed';
  /** Successful Google resolution, even when the place is not a lodging row. */
  anchor?: HotelDiscoveryAnchor;
};

export type NearbyHotelDiscoveryResult = {
  hotels: Hotel[];
  anchor: HotelDiscoveryAnchor | null;
  reason?: 'no_ev_data' | 'failed';
};

function addressPart(place: GooglePlace, types: string[], fallback = '') {
  const component = place.addressComponents?.find(item => item.types?.some(type => types.includes(type)));
  return component?.longText || component?.shortText || fallback;
}

function mapsUrl(place: GooglePlace, fallbackQuery: string) {
  if (place.googleMapsUri) return place.googleMapsUri;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
}

function providerFromName(name: string) {
  return PROVIDER_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? 'Unlisted network';
}

function connectorsFromName(name: string) {
  return [...new Set(CONNECTOR_PATTERNS
    .filter(([pattern]) => pattern.test(name))
    .map(([, value]) => value))];
}

function haversineMeters(a: { latitude?: number; longitude?: number }, b: { latitude?: number; longitude?: number }) {
  const lat1 = Number(a?.latitude);
  const lng1 = Number(a?.longitude);
  const lat2 = Number(b?.latitude);
  const lng2 = Number(b?.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Only property-specific Google place text may claim on-site charging. */
function googleOnSiteEvidence(place: GooglePlace, name: string) {
  const text = [name, place.editorialSummary?.text].filter(Boolean).join(' — ');
  const match = text.match(/\b(?:ev|electric\s+(?:vehicle|car))\s+(?:charging|charger|charge)\b|\bcharger for electric\b/i);
  return match?.[0] ?? null;
}

async function placesRequest(
  path: string,
  init: RequestInit,
  key: string
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${PLACES_BASE}/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) {
      console.error(`[AmpoHotelDiscovery] ${path} failed:`, response.status);
      return null;
    }
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    console.error(`[AmpoHotelDiscovery] ${path} error:`, error);
    return null;
  }
}

async function fetchPlace(placeId: string, key: string): Promise<GooglePlace | null> {
  const data = await placesRequest(
    `places/${encodeURIComponent(placeId)}`,
    {
      method: 'GET',
      headers: { 'X-Goog-FieldMask': HOTEL_MASK.replace(/places\./g, '') },
    },
    key,
  );
  return (data as GooglePlace | null) ?? null;
}

type ResolvedDiscoveryPlace = { place: GooglePlace; anchor: HotelDiscoveryAnchor };

async function searchPlaces(query: string, key: string): Promise<GooglePlace[]> {
  const data = await placesRequest('places:searchText', {
    method: 'POST',
    headers: { 'X-Goog-FieldMask': HOTEL_MASK },
    body: JSON.stringify({
      textQuery: query.slice(0, 180),
      maxResultCount: 5,
      regionCode: 'IN',
      languageCode: 'en',
      locationBias: {
        rectangle: {
          low: { latitude: 6.5, longitude: 68.0 },
          high: { latitude: 35.5, longitude: 97.5 },
        },
      },
    }),
  }, key);
  return (data?.places as GooglePlace[] | undefined) ?? [];
}

/**
 * Resolve a search anchor once. Lodging results are preferred for typed hotel
 * names, but a locality is also a valid anchor for a nearby-hotel sweep.
 */
async function resolveDiscoveryPlace(
  input: { placeId?: string; query?: string },
  key: string
): Promise<ResolvedDiscoveryPlace | null> {
  const placeId = input.placeId?.trim() ?? '';
  const query = input.query?.trim() ?? '';
  if (placeId && !PLACE_ID_RE.test(placeId)) return null;
  if (!placeId && query.length < 3) return null;

  let place: GooglePlace | null = null;
  if (placeId) {
    place = await fetchPlace(placeId, key);
  } else {
    const places = await searchPlaces(query, key);
    place = places.find(item => item.types?.some(type => LODGING_TYPES.has(type)))
      ?? places.find(item => item.location)
      ?? null;
  }

  const lat = Number(place?.location?.latitude);
  const lng = Number(place?.location?.longitude);
  if (!place || ![lat, lng].every(Number.isFinite)) return null;

  return {
    place,
    anchor: {
      placeId: place.id || placeId || undefined,
      label: place.displayName?.text?.trim() || query || placeId || 'Google place',
      query: query || undefined,
      location: { lat, lng },
    },
  };
}

async function searchNearbyLodging(
  location: { lat: number; lng: number },
  key: string
): Promise<GooglePlace[]> {
  const data = await placesRequest('places:searchNearby', {
    method: 'POST',
    headers: { 'X-Goog-FieldMask': HOTEL_MASK },
    body: JSON.stringify({
      includedTypes: ['lodging'],
      maxResultCount: NEARBY_HOTEL_LIMIT,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: location.lat, longitude: location.lng },
          radius: NEARBY_HOTEL_RADIUS_METERS,
        },
      },
    }),
  }, key);
  const places = (data?.places as GooglePlace[] | undefined) ?? [];
  return places.filter(place => place.types?.some(type => LODGING_TYPES.has(type)));
}

async function fetchNearbyChargers(place: GooglePlace, key: string): Promise<GooglePlace[]> {
  const data = await placesRequest('places:searchNearby', {
    method: 'POST',
    headers: { 'X-Goog-FieldMask': CHARGER_MASK },
    body: JSON.stringify({
      includedTypes: ['electric_vehicle_charging_station'],
      maxResultCount: CHARGER_LIMIT,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: {
            latitude: Number(place.location?.latitude),
            longitude: Number(place.location?.longitude),
          },
          radius: RADIUS_METERS,
        },
      },
    }),
  }, key);
  return (data?.places as GooglePlace[] | undefined) ?? [];
}

function toChargers(place: GooglePlace, nearby: GooglePlace[]): Charger[] {
  return nearby
    .filter(charger => charger.id && charger.location)
    .map(charger => {
      const name = charger.displayName?.text || 'EV charging station';
      return {
        placeId: charger.id!,
        name,
        provider: providerFromName(name),
        location: {
          lat: Number(charger.location!.latitude),
          lng: Number(charger.location!.longitude),
        },
        distanceMeters: haversineMeters(place.location!, charger.location!),
        sourceUrl: mapsUrl(charger, name),
        source: 'Google Places API (New)',
        sourceKind: 'google' as const,
        connectors: connectorsFromName(name),
      };
    })
    .filter(charger => Number.isFinite(charger.distanceMeters) && charger.distanceMeters <= RADIUS_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function buildHotel(place: GooglePlace, chargers: Charger[], retrievedAt: string): Hotel | null {
  const placeId = place.id;
  const name = place.displayName?.text?.trim();
  const lat = Number(place.location?.latitude);
  const lng = Number(place.location?.longitude);
  if (!placeId || !PLACE_ID_RE.test(placeId) || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const city = addressPart(place, ['locality', 'administrative_area_level_3']);
  const state = addressPart(place, ['administrative_area_level_1']);
  const locality = addressPart(place, ['sublocality_level_1', 'sublocality', 'neighborhood']);
  const fallbackQuery = [name, city, state].filter(Boolean).join(', ');
  const sourceUrl = mapsUrl(place, fallbackQuery);

  const nearest = chargers[0] ?? null;
  const onSiteText = googleOnSiteEvidence(place, name);
  if (!onSiteText && !nearest) return null;

  const evSignal: Hotel['evSignal'] = onSiteText && nearest
    ? 'both'
    : onSiteText
      ? 'on_site_google_place'
      : 'ev_charger_nearby';
  const connectorTypes = [...new Set(chargers.flatMap(charger => charger.connectors ?? []))];
  const label = onSiteText && nearest
    ? `EV charging listed by Google · charger ${(nearest.distanceMeters / 1000).toFixed(1)} km away`
    : onSiteText
      ? 'EV charging listed by Google Place'
      : `EV charger ${(nearest.distanceMeters / 1000).toFixed(1)} km away`;

  return {
    // Keep the exact Google Place ID in the route so a shared/reloaded detail
    // page can re-discover the property. Place IDs contain only URL-safe chars.
    id: `google-${placeId}`,
    name,
    area: city || locality || state || 'India',
    city,
    state,
    locality,
    formattedAddress: place.formattedAddress || '',
    location: { lat, lng },
    interestTags: [],
    rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
    ratingSource: 'google',
    priceBand: place.priceLevel ? PRICE_LABELS[place.priceLevel] ?? null : null,
    source: 'Google Places API (New) · discovered by search',
    sourceUrl,
    websiteUrl: place.websiteUri || null,
    tripadvisorUrl: null,
    sources: [{
      kind: 'google',
      label: 'Google Maps place',
      url: sourceUrl,
      verifiedAt: retrievedAt,
      verificationMethod: 'google_places_place_id',
    }],
    photo: place.photos?.[0]?.name ? {
      reference: place.photos[0].name,
      sourceUrl,
      localPath: null,
    } : null,
    evSignal,
    onSiteEvidence: onSiteText,
    onSiteEvidenceSource: onSiteText ? {
      label: 'Google Places place details',
      url: sourceUrl,
      quote: onSiteText,
      verifiedAt: retrievedAt,
      verificationMethod: 'google_places_place_id',
    } : null,
    ev: {
      label,
      nearestCharger: nearest,
      chargerCountWithinRadius: chargers.length,
      providers: [...new Set(chargers.map(charger => charger.provider))],
      radiusMeters: RADIUS_METERS,
      connectorTypes,
      connectorSource: 'Google Maps place name',
      nearbyChargerSources: chargers,
    },
    provenance: {
      placeId,
      retrievedAt,
      demandUrl: sourceUrl,
      hotelLookup: 'Google Places API (New) place details',
      chargerLookup: 'Google Places API (New) places:searchNearby',
      coordinatesAsOf: retrievedAt,
    },
  };
}

/**
 * Verify one Google place and build a real hotel row. `placeId` comes from our
 * own autocomplete; `query` is the fallback when a user presses Enter without
 * picking a suggestion.
 */
export async function discoverHotel(
  input: { placeId?: string; query?: string },
  apiKey: string | undefined
): Promise<HotelDiscoveryResult> {
  if (!apiKey) return { hotel: null, reason: 'not_configured' };

  try {
    const resolved = await resolveDiscoveryPlace(input, apiKey);
    if (!resolved) return { hotel: null, reason: 'failed' };
    const { place, anchor } = resolved;
    if (!place.types?.some(type => LODGING_TYPES.has(type))) {
      return { hotel: null, reason: 'not_lodging', anchor };
    }

    const chargers = toChargers(place, await fetchNearbyChargers(place, apiKey));
    const hotel = buildHotel(place, chargers, new Date().toISOString());
    return hotel ? { hotel, anchor } : { hotel: null, reason: 'no_ev_data', anchor };
  } catch (error) {
    console.error('[AmpoHotelDiscovery] failed:', error);
    return { hotel: null, reason: 'failed' };
  }
}

/**
 * Bounded nearby sweep used by the queued growth script. It caches up to 20
 * real Google lodging places within 10 km of the searched anchor, keeping only
 * rows with property-specific on-site text or a real public charger nearby.
 */
export async function discoverNearbyHotels(
  input: { placeId?: string; query?: string },
  apiKey: string | undefined,
  options: { delayMs?: number } = {}
): Promise<NearbyHotelDiscoveryResult> {
  if (!apiKey) return { hotels: [], anchor: null, reason: 'failed' };

  try {
    const resolved = await resolveDiscoveryPlace(input, apiKey);
    if (!resolved) return { hotels: [], anchor: null, reason: 'failed' };
    const { anchor } = resolved;
    const lodging = await searchNearbyLodging(anchor.location, apiKey);
    const retrievedAt = new Date().toISOString();
    const seen = new Set<string>();
    const hotels: Hotel[] = [];

    for (const place of lodging.slice(0, NEARBY_HOTEL_LIMIT)) {
      const placeId = place.id;
      if (!placeId || seen.has(placeId)) continue;
      const distanceMeters = haversineMeters(
        { latitude: anchor.location.lat, longitude: anchor.location.lng },
        place.location ?? {}
      );
      if (!Number.isFinite(distanceMeters) || distanceMeters > NEARBY_HOTEL_RADIUS_METERS) continue;
      seen.add(placeId);

      try {
        const chargers = toChargers(place, await fetchNearbyChargers(place, apiKey));
        const hotel = buildHotel(place, chargers, retrievedAt);
        if (hotel) hotels.push(hotel);
      } catch (error) {
        console.error(`[AmpoHotelDiscovery] nearby hotel ${placeId} failed:`, error);
      }
      if (options.delayMs && options.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs));
      }
    }

    return { hotels, anchor, reason: hotels.length ? undefined : 'no_ev_data' };
  } catch (error) {
    console.error('[AmpoHotelDiscovery] nearby sweep failed:', error);
    return { hotels: [], anchor: null, reason: 'failed' };
  }
}
