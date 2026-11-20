import postgres from 'postgres';

export interface EnrichableStation {
  id: string;
  station_name: string;
  provider: string;
  address: string;
  city?: string | null;
  state?: string | null;
  latitude: number;
  longitude: number;
}

export interface PlaceDetails {
  displayName?: string;
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: { latitude: number; longitude: number };
  match?: boolean;
  checkedAt?: string;
  candidates?: Array<{ name: string; distanceKm: number }>;
  error?: string;
}

export interface EnrichmentResult {
  id: string;
  matched: boolean;
  photoCount: number;
  error?: string;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  photos?: Array<{ name?: string; widthPx?: number; heightPx?: number }>;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  websiteUri?: string;
  googleMapsUri?: string;
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.photos.name',
  'places.photos.widthPx',
  'places.photos.heightPx',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.websiteUri',
  'places.googleMapsUri',
].join(',');

const GENERIC_WORDS = new Set([
  'charging', 'charge', 'charger', 'station', 'stations', 'ev', 'electric',
  'vehicle', 'vehicles', 'point', 'points', 'india', 'public', 'fast',
]);

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value: string, includeGeneric = false): string[] {
  const parts = normalise(value).split(/\s+/).filter(Boolean);
  const filtered = includeGeneric ? parts : parts.filter(part => !GENERIC_WORDS.has(part) && part.length > 2);
  return filtered.length ? filtered : parts;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(value => setB.has(value)).length;
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

function isPlausibleMatch(station: EnrichableStation, place: GooglePlace, distanceKm: number): boolean {
  const placeName = place.displayName?.text ?? '';
  const stationName = normalise(station.station_name);
  const placeNameNorm = normalise(placeName);
  const exact =
    stationName.length > 3 &&
    (placeNameNorm === stationName || placeNameNorm.includes(stationName) || stationName.includes(placeNameNorm));

  const similarity = jaccard(
    tokens(`${station.station_name} ${station.provider}`),
    tokens(placeName)
  );

  if (exact && distanceKm <= 5) return true;
  if (distanceKm <= 0.3 && similarity >= 0.15) return true;
  if (distanceKm <= 1.5 && similarity >= 0.4) return true;
  return false;
}

function buildQuery(station: EnrichableStation): string {
  const locality = [station.city, station.state].filter(Boolean).join(', ');
  return [station.station_name, station.provider, locality || station.address, 'EV charging station']
    .filter(Boolean)
    .join(', ');
}

export function createEnrichmentDb() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('POSTGRES_URL / POSTGRES_URL_NON_POOLING is not configured');
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: 'require',
    prepare: false,
  });

  return {
    async pending(limit: number, offset: number): Promise<EnrichableStation[]> {
      return sql<EnrichableStation[]>`
        SELECT id, station_name, provider, address, city, state, latitude, longitude
        FROM public.ev_charging_stations
        WHERE photo_enriched_at IS NULL
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `;
    },

    async remaining(): Promise<number> {
      const rows = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM public.ev_charging_stations
        WHERE photo_enriched_at IS NULL
      `;
      return rows[0]?.count ?? 0;
    },

    async update(id: string, placeId: string | null, photoRefs: string[], details: PlaceDetails): Promise<void> {
      await sql`
        UPDATE public.ev_charging_stations
        SET
          google_place_id = ${placeId},
          photo_references = ${photoRefs},
          place_details = ${JSON.stringify(details)}::jsonb,
          photo_enriched_at = now()
        WHERE id = ${id}::uuid
      `;
    },

    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

export async function enrichStation(
  station: EnrichableStation,
  apiKey: string
): Promise<{ placeId: string | null; photoRefs: string[]; details: PlaceDetails }> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: buildQuery(station),
      locationBias: {
        circle: {
          center: { latitude: station.latitude, longitude: station.longitude },
          radius: 2500,
        },
      },
      maxResultCount: 5,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Google Places ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = await response.json() as { places?: GooglePlace[] };
  const places = data.places ?? [];
  const candidates = places.map(place => {
    const lat = place.location?.latitude ?? 0;
    const lng = place.location?.longitude ?? 0;
    return {
      place,
      distanceKm: haversineKm(station.latitude, station.longitude, lat, lng),
    };
  });

  const match = candidates
    .filter(candidate => isPlausibleMatch(station, candidate.place, candidate.distanceKm))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  const details: PlaceDetails = {
    match: Boolean(match),
    checkedAt: new Date().toISOString(),
    candidates: candidates.slice(0, 5).map(candidate => ({
      name: candidate.place.displayName?.text ?? 'Unnamed place',
      distanceKm: Math.round(candidate.distanceKm * 100) / 100,
    })),
  };

  if (!match) return { placeId: null, photoRefs: [], details };

  const place = match.place;
  Object.assign(details, {
    displayName: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    businessStatus: place.businessStatus,
    websiteUri: place.websiteUri,
    googleMapsUri: place.googleMapsUri,
    location: place.location,
  });

  const photoRefs = (place.photos ?? [])
    .map(photo => photo.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 5);

  return { placeId: place.id ?? null, photoRefs, details };
}

export async function runPhotoEnrichment(
  apiKey: string,
  limit: number,
  offset = 0
): Promise<{
  scanned: number;
  matched: number;
  withPhotos: number;
  errors: number;
  remaining: number;
}> {
  const db = createEnrichmentDb();
  const results: EnrichmentResult[] = [];
  try {
    const stations = await db.pending(limit, offset);
    const concurrency = 4;
    for (let index = 0; index < stations.length; index += concurrency) {
      const batch = stations.slice(index, index + concurrency);
      const batchResults = await Promise.all(
        batch.map(async station => {
          try {
            const enriched = await enrichStation(station, apiKey);
            await db.update(station.id, enriched.placeId, enriched.photoRefs, enriched.details);
            return {
              id: station.id,
              matched: Boolean(enriched.placeId),
              photoCount: enriched.photoRefs.length,
            };
          } catch (error) {
            return {
              id: station.id,
              matched: false,
              photoCount: 0,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );
      results.push(...batchResults);
    }

    return {
      scanned: results.length,
      matched: results.filter(result => result.matched).length,
      withPhotos: results.filter(result => result.photoCount > 0).length,
      errors: results.filter(result => result.error).length,
      remaining: await db.remaining(),
    };
  } finally {
    await db.close();
  }
}
