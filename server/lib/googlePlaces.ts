/**
 * Google Places (New) helpers for typed-location search.
 *
 * The browser never holds GOOGLE_MAPS_API_KEY: it asks /api/stations for
 * suggestions and the server resolves the chosen place to coordinates. Keeping
 * these helpers in server/lib/ avoids adding a Vercel function (Hobby limit).
 * Nothing here is cached permanently — treat the data as a point-in-time
 * lookup, per Google's terms.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';
const TIMEOUT_MS = 6000;

export interface PlaceSuggestion {
  placeId: string;
  label: string;
  primaryText: string;
  secondaryText: string;
}

export interface ResolvedPlace {
  placeId: string;
  label: string;
  lat: number;
  lng: number;
}

function apiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY;
}

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

async function placesRequest(url: string, init: RequestInit): Promise<Response | null> {
  const key = apiKey();
  if (!key) {
    console.warn('[AmpoPlaces] GOOGLE_MAPS_API_KEY is not configured');
    return null;
  }
  try {
    return await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[AmpoPlaces] request failed:', error);
    return null;
  }
}

/**
 * India is the product's only market. Without an explicit bias, Google's IP
 * heuristics can rank "Goa" in the US above "Goa, India" for users abroad.
 * `includedRegionCodes` restricts predictions; the rectangle is a ranking
 * hint for places near the subcontinent.
 */
const INDIA_BIAS = {
  includedRegionCodes: ['IN'],
  regionCode: 'IN',
  languageCode: 'en',
  locationBias: {
    // Places API (New) Viewport uses low/high (southwest/northeast), not
    // northeast/southwest keys.
    rectangle: {
      low: { latitude: 6.5, longitude: 68.0 },
      high: { latitude: 35.5, longitude: 97.5 },
    },
  },
};

/** Uber-style place picker data: no coordinates yet, just human-readable choices. */
export async function suggestPlaces(input: string): Promise<PlaceSuggestion[]> {
  const value = input.trim();
  if (value.length < 2) return [];
  const response = await placesRequest(`${PLACES_BASE}/places:autocomplete`, {
    method: 'POST',
    body: JSON.stringify({
      input: value,
      ...INDIA_BIAS,
      includedPrimaryTypes: [
        'locality',
        'sublocality',
        'administrative_area_level_3',
        'point_of_interest',
        'establishment',
      ],
    }),
    headers: {
      'X-Goog-FieldMask': [
        'suggestions.placePrediction.placeId',
        'suggestions.placePrediction.text.text',
        'suggestions.placePrediction.structuredFormat.mainText.text',
        'suggestions.placePrediction.structuredFormat.secondaryText.text',
        'suggestions.placePrediction.types',
      ].join(','),
    },
  });
  if (!response?.ok) {
    if (response) console.error('[AmpoPlaces] autocomplete failed:', response.status);
    return [];
  }
  const data = (await response.json()) as {
    suggestions?: Array<{ placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    } }>;
  };
  const suggestions: PlaceSuggestion[] = [];
  for (const suggestion of data.suggestions ?? []) {
    const prediction = suggestion.placePrediction;
    if (!prediction?.placeId || !PLACE_ID_RE.test(prediction.placeId)) continue;
    const primaryText = prediction.structuredFormat?.mainText?.text?.trim() ?? '';
    const secondaryText = prediction.structuredFormat?.secondaryText?.text?.trim() ?? '';
    const label = prediction.text?.text?.trim()
      ?? [primaryText, secondaryText].filter(Boolean).join(', ');
    if (!label) continue;
    suggestions.push({
      placeId: prediction.placeId,
      label,
      primaryText: primaryText || label,
      secondaryText,
    });
    if (suggestions.length === 6) break;
  }
  return suggestions;
}

function toResolvedPlace(
  placeId: string | undefined,
  displayName: string | undefined,
  formattedAddress: string | undefined,
  location: { latitude?: number; longitude?: number } | undefined
): ResolvedPlace | null {
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  if (!placeId || !PLACE_ID_RE.test(placeId) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  // Google's displayName is the corrected/authoritative spelling; the full
  // address is only a fallback for places without a display name.
  const label = displayName?.trim() || formattedAddress?.trim() || '';
  return label ? { placeId, label, lat, lng } : null;
}

/** Exact coordinates for a place the user picked from the dropdown. */
export async function resolvePlaceById(placeId: string): Promise<ResolvedPlace | null> {
  if (!PLACE_ID_RE.test(placeId)) return null;
  const response = await placesRequest(
    `${PLACES_BASE}/places/${encodeURIComponent(placeId)}?fields=id,displayName,formattedAddress,location`,
    {
      method: 'GET',
      headers: { 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' },
    }
  );
  if (!response?.ok) {
    if (response) console.error('[AmpoPlaces] place details failed:', response.status);
    return null;
  }
  const place = (await response.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  };
  return toResolvedPlace(
    place.id ?? placeId,
    place.displayName?.text,
    place.formattedAddress,
    place.location
  );
}

/** Resolve a typed query (including misspellings) when no suggestion was picked. */
export async function searchPlaceByText(query: string): Promise<ResolvedPlace | null> {
  const value = query.trim();
  if (!value) return null;
  const response = await placesRequest(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    body: JSON.stringify({ textQuery: value, maxResultCount: 5 }),
    headers: {
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName.text',
        'places.formattedAddress',
        'places.location.latitude',
        'places.location.longitude',
      ].join(','),
    },
  });
  if (!response?.ok) {
    if (response) console.error('[AmpoPlaces] text search failed:', response.status);
    return null;
  }
  const data = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }>;
  };
  for (const place of data.places ?? []) {
    const resolved = toResolvedPlace(
      place.id,
      place.displayName?.text,
      place.formattedAddress,
      place.location
    );
    if (resolved) return resolved;
  }
  return null;
}
