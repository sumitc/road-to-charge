export type StationStatus = 'operational' | 'maintenance' | 'out-of-service';
export type VehicleClass = 'car' | 'two_three_wheeler';
export type ChargingCurrent = 'AC' | 'DC';
export type Ownership = 'govt' | 'private';
export type LocationQuality = 'ok' | 'suspect';
export type StationType = 'charging' | 'battery_swapping';

/** Connector/gun level detail, mirroring OCPI EVSEs, BEE `guns[]` and Google `connectorAggregation`. */
export interface ConnectorDetail {
  standard: string;
  /** Power delivered to one vehicle by a single gun. */
  kw?: number;
  /** Total rating of the charger (can exceed the per-gun rating). */
  chargerKw?: number;
  count?: number;
  availableCount?: number;
  outOfServiceCount?: number;
  lastUpdate?: string;
}

/** Google Places details cached server-side for a station. */
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
  photoQuality?: 'good' | 'mixed' | 'poor';
  photoSource?: {
    name: string;
    kind: string;
    distanceMeters: number;
    placeId?: string;
    note: string;
  };
}

export interface StationFeedback {
  total: number;
  working: number;
  notWorking: number;
  wrongLocation: number;
  other: number;
  lastWorkingAt?: string | null;
  lastNotWorkingAt?: string | null;
  recent: Array<{ kind: string; note?: string | null; createdAt: string }>;
}

export interface ChargingStation {
  id: string;
  name: string;
  provider: string;
  address: string;
  lat: number;
  lng: number;
  distance: number;
  status: StationStatus;
  connectorTypes?: string[];
  powerOutput?: string;
  pricing?: string;

  // Enriched dictionary fields (populated by the new sync sources).
  connectors?: ConnectorDetail[];
  maxPowerKw?: number;
  maxKwByStandard?: Record<string, number>;
  totalChargers?: number;
  totalConnectors?: number;
  vehicleClasses?: VehicleClass[];
  current?: ChargingCurrent;
  ownership?: Ownership;
  state?: string;
  district?: string;
  city?: string;
  locationQuality?: LocationQuality;
  mixedAdmin?: boolean;
  openingHours?: string;
  paymentModes?: string[];
  contactNumbers?: string[];
  staff?: string;
  access?: string;
  fee?: boolean;
  stationType?: StationType;
  availableCount?: number;
  outOfServiceCount?: number;
  availabilityLastUpdate?: string;
  lastRiderReport?: string;
  dataAsOf?: string;
  mapsLink?: string;
  googlePlaceId?: string;
  photoRefs?: string[];
  placeDetails?: PlaceDetails;
  photoEnrichedAt?: string;
  sourceName?: string;
  sourceUrl?: string;
}

export interface UserLocation {
  lat: number;
  lng: number;
}
