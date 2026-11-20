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

interface Candidate {
  place: GooglePlace;
  distanceKm: number;
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

// Catalog providers are abbreviations; Google Maps usually lists the full
// fuel brand (or "IndianOil" as one word). Matching both is essential.
const PROVIDER_ALIASES: Record<string, string[]> = {
  BPCL: ['bharat petroleum', 'bpcl', 'bharat petrol'],
  IOCL: ['indian oil', 'indianoil', 'iocl', 'indian oil corporation'],
  HPCL: ['hindustan petroleum', 'hpcl', 'hindustan petrol'],
  'RELIANCE BP': ['reliance bp', 'bp pulse', 'reliance'],
  'TATA POWER': ['tata power', 'tata'],
  ATHER: ['ather'],
  OLA: ['ola'],
  REIL: ['reil'],
  KSEB: ['kseb', 'kerala state electricity board'],
  UJOY: ['ujoy'],
  FORTUM: ['fortum'],
  EESL: ['eesl'],
  NTPC: ['ntpc'],
};

const FUEL_PROVIDERS = new Set(['BPCL', 'IOCL', 'HPCL', 'RELIANCE BP']);
const FUEL_PLACE_RE = /petrol|fuel|indianoil|indian oil|bharat petroleum|hindustan petroleum|hpcl|bpcl|iocl/;

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

/** Remove catalog bookkeeping like ", City=..., District=..., State=...". */
function cleanLabel(value: string): string {
  return value
    .replace(/,\s*(?:City|District|State|Pincode|Pin|Country)\s*=.*$/gi, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s*,\s*$/, '')
    .trim();
}

function providerAliases(provider: string): string[] {
  const key = provider.trim().toUpperCase();
  return PROVIDER_ALIASES[key] ?? [provider];
}

function locality(station: EnrichableStation): string {
  return [station.city, station.state]
    .filter(Boolean)
    .map(value => cleanLabel(String(value)))
    .filter(Boolean)
    .join(', ');
}

function buildQueries(station: EnrichableStation): string[] {
  const cleanName = cleanLabel(station.station_name);
  const area = locality(station);
  const aliases = providerAliases(station.provider);
  const primaryAlias = aliases[0] ?? station.provider;
  const isFuel = FUEL_PROVIDERS.has(station.provider.trim().toUpperCase());

  const queries = [
    [cleanName, station.provider, area].filter(Boolean).join(', '),
    isFuel
      ? [primaryAlias, 'petrol pump', area].filter(Boolean).join(', ')
      : [primaryAlias, 'EV charging station', area].filter(Boolean).join(', '),
  ];

  return [...new Set(queries.filter(query => query.length > 3))];
}

function isPlausibleMatch(station: EnrichableStation, place: GooglePlace, distanceKm: number): boolean {
  const placeName = place.displayName?.text ?? '';
  const placeNameNorm = normalise(placeName);
  const cleanName = cleanLabel(station.station_name);
  const cleanNameNorm = normalise(cleanName);
  const aliases = providerAliases(station.provider);
  const providerMatch = aliases.some(alias => placeNameNorm.includes(normalise(alias)));
  const exact =
    cleanNameNorm.length > 3 &&
    (placeNameNorm === cleanNameNorm ||
      placeNameNorm.includes(cleanNameNorm) ||
      cleanNameNorm.includes(placeNameNorm));
  const similarity = jaccard(tokens(`${cleanName} ${station.provider}`), tokens(placeName));
  const isFuel = FUEL_PROVIDERS.has(station.provider.trim().toUpperCase());
  const fuelPlace = FUEL_PLACE_RE.test(placeNameNorm);

  if (exact && distanceKm <= 5) return true;
  // Google often indexes a fuel pump simply as "IndianOil" / "Bharat
  // Petroleum" with no catalog-style name at all. At the same coordinates
  // that is still the right entity and its photos are the ones riders want.
  if (distanceKm <= 0.2 && (providerMatch || exact || (isFuel && fuelPlace) || similarity >= 0.2)) return true;
  if (distanceKm <= 0.5 && similarity >= 0.15) return true;
  if (distanceKm <= 1.5 && similarity >= 0.4) return true;
  return false;
}

function pickBest(candidates: Candidate[]): Candidate | undefined {
  return [...candidates].sort((a, b) => {
    // Two Google listings can share the same coordinates; prefer the one with
    // photos so the list view actually shows an image.
    if (Math.abs(a.distanceKm - b.distanceKm) < 0.15) {
      return (b.place.photos?.length ?? 0) - (a.place.photos?.length ?? 0);
    }
    return a.distanceKm - b.distanceKm;
  })[0];
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
  const seen = new Set<string>();
  const allCandidates: Candidate[] = [];
  let match: Candidate | undefined;
  let lastError: string | undefined;
  let succeededAny = false;

  for (const query of buildQueries(station)) {
    let places: GooglePlace[];
    try {
      // Location bias is applied here because the query string itself must
      // stay short enough for Google's text search to return the entity.
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query,
          locationBias: {
            circle: {
              center: { latitude: station.latitude, longitude: station.longitude },
              radius: 3000,
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
      places = data.places ?? [];
      succeededAny = true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }

    const candidates: Candidate[] = places.map(place => ({
      place,
      distanceKm: haversineKm(
        station.latitude,
        station.longitude,
        place.location?.latitude ?? 0,
        place.location?.longitude ?? 0
      ),
    }));

    for (const candidate of candidates) {
      if (candidate.place.id && !seen.has(candidate.place.id)) {
        seen.add(candidate.place.id);
        allCandidates.push(candidate);
      }
    }

    const plausible = candidates.filter(candidate =>
      isPlausibleMatch(station, candidate.place, candidate.distanceKm)
    );
    if (plausible.length) {
      match = pickBest(plausible);
      break;
    }
  }

  if (!succeededAny && lastError) throw new Error(lastError);

  const details: PlaceDetails = {
    match: Boolean(match),
    checkedAt: new Date().toISOString(),
    candidates: allCandidates
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5)
      .map(candidate => ({
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
    const lookups: Array<{
      station: EnrichableStation;
      enriched?: Awaited<ReturnType<typeof enrichStation>>;
      error?: string;
    }> = [];

    // Google calls can run in parallel, but writes stay sequential: the pooled
    // Postgres connection used on Vercel deadlocks under concurrent updates.
    for (let index = 0; index < stations.length; index += concurrency) {
      const batch = stations.slice(index, index + concurrency);
      lookups.push(...await Promise.all(
        batch.map(async station => {
          try {
            return {
              station,
              enriched: await enrichStation(station, apiKey),
            };
          } catch (error) {
            return {
              station,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      ));
      console.log(`Enriched ${Math.min(index + concurrency, stations.length)}/${stations.length} place lookups`);
    }

    for (const lookup of lookups) {
      if (lookup.error) {
        results.push({
          id: lookup.station.id,
          matched: false,
          photoCount: 0,
          error: lookup.error,
        });
        continue;
      }
      const enriched = lookup.enriched!;
      await db.update(lookup.station.id, enriched.placeId, enriched.photoRefs, enriched.details);
      results.push({
        id: lookup.station.id,
        matched: Boolean(enriched.placeId),
        photoCount: enriched.photoRefs.length,
      });
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
