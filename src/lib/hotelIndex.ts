import evIndex from '@/data/hotels-ev.index.generated.json';

export type Charger = {
  placeId: string;
  name: string;
  provider: string;
  location: { lat: number; lng: number };
  distanceMeters: number;
  sourceUrl: string;
  source?: string;
  sourceKind?: 'google' | 'db' | 'osm' | 'ocm';
  mentionsHotel?: boolean;
  /** Canonical connector filter values from the source (if available). */
  connectors?: string[];
  googleConnectorTypes?: string[];
};

export type SourceLink = {
  kind: 'google' | 'tripadvisor' | 'hotel_website' | 'affiliate';
  label: string;
  url: string;
  verifiedAt?: string;
  verificationMethod?: 'google_places_place_id' | 'official_property_page' | 'websearch_exact_match' | 'terra_api_supplied_url' | 'affiliate_network_generated';
  affiliate?: boolean;
};

export type OnSiteEvidence = {
  label: string;
  url: string;
  quote: string;
  verifiedAt: string;
  verificationMethod: string;
};

export type Hotel = {
  id: string;
  name: string;
  area: string;
  city: string;
  state: string;
  locality?: string;
  formattedAddress?: string;
  location: { lat: number; lng: number };
  interestTags: string[];
  rating: number | null;
  ratingSource?: 'google';
  priceBand: string | null;
  source: string;
  sourceUrl: string;
  websiteUrl?: string | null;
  tripadvisorUrl?: string | null;
  sources?: SourceLink[];
  photo?: {
    reference: string;
    sourceUrl: string;
    localPath?: string | null;
  } | null;
  evSignal: 'on_site_google_place' | 'on_site_official_source' | 'ev_charger_nearby' | 'both';
  onSiteEvidence?: string | null;
  onSiteEvidenceSource?: OnSiteEvidence | null;
  ev: {
    label: string;
    nearestCharger: Charger | null;
    chargerCountWithinRadius: number;
    providers: string[];
    radiusMeters: number;
    connectorTypes?: string[];
    connectorSource?: string;
    nearbyChargerSources?: Charger[];
  };
  provenance: {
    placeId: string;
    retrievedAt: string;
    demandUrl: string;
  };
};

export type HotelIndex = {
  generatedAt: string;
  connectorEnrichedAt?: string;
  multiSourceEnrichedAt?: string;
  indexVersion: number;
  method: { source: string; radiusMeters: number; [key: string]: unknown };
  coverage: {
    areasRequested: number;
    hotelsIndexed: number;
    evSignalCounts: Record<string, number>;
    providers: string[];
    priceBands: string[];
    chargerSourceRows?: Record<string, number>;
    multiSourceErrors?: string[];
  };
  areas: Array<{
    id: string;
    name: string;
    city?: string;
    state: string;
    placeId?: string;
    coordinates?: { lat: number; lng: number };
  }>;
  hotels: Hotel[];
};

export const hotelIndex = evIndex as unknown as HotelIndex;

/**
 * Only an authentic, property-specific source may produce "EV on site".
 * A charger within any radius — even 250 m — stays "Charger nearby".
 */
export function hasAuthenticOnSiteEvidence(hotel: Hotel): boolean {
  const sourcedSignal = hotel.evSignal === 'both'
    || hotel.evSignal === 'on_site_google_place'
    || hotel.evSignal === 'on_site_official_source';
  return Boolean(
    sourcedSignal
    && hotel.onSiteEvidence
    && hotel.onSiteEvidenceSource?.url
  );
}

export function findHotel(id: string | undefined): Hotel | undefined {
  if (!id) return undefined;
  return hotelIndex.hotels.find(hotel => hotel.id === id);
}
