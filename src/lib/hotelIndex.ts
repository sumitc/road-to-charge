import evIndex from '@/data/hotels-ev.index.generated.json';

export type Charger = {
  placeId: string;
  name: string;
  provider: string;
  location: { lat: number; lng: number };
  distanceMeters: number;
  sourceUrl: string;
};

export type SourceLink = {
  kind: 'google' | 'tripadvisor' | 'hotel_website' | 'affiliate';
  label: string;
  url: string;
  verifiedAt?: string;
  verificationMethod?: 'google_places_place_id' | 'websearch_exact_match' | 'terra_api_supplied_url' | 'affiliate_network_generated';
  affiliate?: boolean;
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
  evSignal: 'on_site_google_place' | 'ev_charger_nearby' | 'both';
  onSiteEvidence?: string | null;
  ev: {
    label: string;
    nearestCharger: Charger | null;
    chargerCountWithinRadius: number;
    providers: string[];
    radiusMeters: number;
  };
  provenance: {
    placeId: string;
    retrievedAt: string;
    demandUrl: string;
  };
};

export type HotelIndex = {
  generatedAt: string;
  indexVersion: number;
  method: { source: string; radiusMeters: number };
  coverage: {
    areasRequested: number;
    hotelsIndexed: number;
    evSignalCounts: Record<string, number>;
    providers: string[];
    priceBands: string[];
  };
  areas: Array<{ id: string; name: string; city?: string; state: string }>;
  hotels: Hotel[];
};

export const hotelIndex = evIndex as unknown as HotelIndex;

export function findHotel(id: string | undefined): Hotel | undefined {
  if (!id) return undefined;
  return hotelIndex.hotels.find(hotel => hotel.id === id);
}
