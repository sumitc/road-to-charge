import type { Tables } from '@/integrations/supabase/types';
import type { GoogleRefreshInfo } from '@/lib/googleArea';
import { displayStationAddress, displayStationName } from '@/lib/provider';
import type {
  ChargingCurrent,
  ChargingStation,
  ConnectorDetail,
  LocationQuality,
  Ownership,
  PlaceDetails,
  StationFeedback,
  StationStatus,
  StationType,
  UserLocation,
  VehicleClass,
} from '@/types/station';

type StationRow = Tables<'ev_charging_stations'>;

export interface StationFilters {
  minPowerKw?: number;
  vehicleClass?: VehicleClass;
  current?: ChargingCurrent;
  connector?: string;
  state?: string;
  city?: string;
  ownership?: Ownership;
  stationType?: StationType;
}

export interface PlaceSuggestion {
  placeId: string;
  label: string;
  primaryText: string;
  secondaryText: string;
}

/** Read stations through our direct-SQL API (Supabase REST is unavailable on this plan). */
const fetchStations = async (
  params: Record<string, string | number | undefined>,
  onHeaders?: (headers: Headers) => void
): Promise<StationRow[]> => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const response = await fetch(`/api/stations?${search.toString()}`);
  if (!response.ok) throw new Error(`Stations API failed: ${response.status}`);
  onHeaders?.(response.headers);

  // The API reports when a query claimed a Google gap-fill cell. Broadcast it
  // so the refresh notice can follow the job to completion without blocking
  // the station list.
  const refreshHeader = response.headers.get('X-Ampo-Google-Refresh');
  if (refreshHeader && typeof window !== 'undefined') {
    try {
      const info = JSON.parse(decodeURIComponent(refreshHeader)) as GoogleRefreshInfo;
      window.dispatchEvent(new CustomEvent('ampo-google-refresh', { detail: info }));
    } catch {
      // A malformed header must never break station loading.
    }
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows as StationRow[] : [];
};

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export class EVStationService {
  /** Map a database row into the frontend dictionary shape. */
  private static mapStation(station: StationRow, distance = 0): ChargingStation {
    const connectors = Array.isArray(station.connectors)
      ? (station.connectors as unknown as ConnectorDetail[])
      : undefined;

    const maxKwByStandard =
      station.max_kw_by_standard &&
      typeof station.max_kw_by_standard === 'object' &&
      !Array.isArray(station.max_kw_by_standard)
        ? (station.max_kw_by_standard as unknown as Record<string, number>)
        : undefined;

    const displaySource = {
      name: station.station_name,
      address: station.address,
      provider: station.provider,
      city: station.city,
      state: station.state,
    };

    return {
      id: station.id,
      name: displayStationName(displaySource),
      provider: station.provider,
      address: displayStationAddress(displaySource),
      lat: toNumber(station.latitude) ?? 0,
      lng: toNumber(station.longitude) ?? 0,
      distance,
      status: this.mapAvailabilityStatus(station.availability_status),
      connectorTypes: station.connector_types ?? connectors?.map(c => c.standard),
      powerOutput: station.power_output ??
        (station.max_power_kw !== null ? `${station.max_power_kw}kW` : undefined),
      pricing: station.pricing ?? undefined,

      connectors,
      maxPowerKw: toNumber(station.max_power_kw),
      maxKwByStandard,
      totalChargers: station.total_chargers ?? undefined,
      totalConnectors: station.total_connectors ?? undefined,
      vehicleClasses: station.vehicle_classes?.length
        ? (station.vehicle_classes as VehicleClass[])
        : undefined,
      current: (station.charging_current as ChargingCurrent | null) ?? undefined,
      ownership: (station.ownership as Ownership | null) ?? undefined,
      state: station.state ?? undefined,
      district: station.district ?? undefined,
      city: station.city ?? undefined,
      locationQuality: (station.location_quality as LocationQuality | null) ?? undefined,
      mixedAdmin: station.mixed_admin ?? undefined,
      openingHours: station.opening_hours ?? undefined,
      paymentModes: station.payment_modes?.length ? station.payment_modes : undefined,
      contactNumbers: station.contact_numbers?.length ? station.contact_numbers : undefined,
      staff: station.staff ?? undefined,
      access: station.access ?? undefined,
      fee: station.fee ?? undefined,
      stationType: (station.station_type as StationType | null) ?? undefined,
      availableCount: station.available_count ?? undefined,
      outOfServiceCount: station.out_of_service_count ?? undefined,
      availabilityLastUpdate: station.availability_last_update ?? undefined,
      lastRiderReport: station.last_rider_report ?? undefined,
      dataAsOf: station.data_as_of ?? undefined,
      mapsLink: station.maps_link ?? undefined,
      googlePlaceId: station.google_place_id ?? undefined,
      photoRefs: Array.isArray(station.photo_references) ? station.photo_references : undefined,
      placeDetails: station.place_details && typeof station.place_details === 'object' && !Array.isArray(station.place_details)
        ? (station.place_details as unknown as PlaceDetails)
        : undefined,
      photoEnrichedAt: station.photo_enriched_at ?? undefined,
      sourceName: station.source_name ?? undefined,
      sourceUrl: station.source_url ?? undefined,
    };
  }

  /**
   * Get stations within a specified radius of user location
   */
  static async getStationsWithDistance(
    userLocation: UserLocation,
    radius: number = 10
  ): Promise<ChargingStation[]> {
    try {
      const stations = await fetchStations({
        mode: 'distance',
        lat: userLocation.lat,
        lng: userLocation.lng,
        radius,
      });

      // Calculate exact distances and filter by radius
      return stations
        .map(station => {
          const lat = toNumber(station.latitude) ?? 0;
          const lng = toNumber(station.longitude) ?? 0;
          return this.mapStation(
            station,
            this.calculateDistance(userLocation.lat, userLocation.lng, lat, lng)
          );
        })
        .filter(station => station.distance <= radius)
        .sort((a, b) => a.distance - b.distance);
    } catch (error) {
      console.error('Error in getStationsWithDistance:', error);
      return [];
    }
  }

  /**
   * Google Places autocomplete choices for the search dropdown. The API key
   * never reaches the browser; /api/stations calls Places on our behalf.
   */
  static async suggestPlaces(query: string): Promise<PlaceSuggestion[]> {
    try {
      const normalized = query.trim().replace(/\s+/g, ' ');
      if (normalized.length < 2) return [];
      const response = await fetch(
        `/api/stations?mode=suggest&q=${encodeURIComponent(normalized)}`
      );
      if (!response.ok) return [];
      const suggestions = await response.json();
      return Array.isArray(suggestions) ? suggestions as PlaceSuggestion[] : [];
    } catch (error) {
      console.error('Error in suggestPlaces:', error);
      return [];
    }
  }

  /**
   * Search for stations by a typed query or an exact Google place selection.
   * `onResolved` receives Google's corrected place name plus the exact place
   * coordinates, so the UI can fix a misspelling and centre distances on the
   * chosen place instead of on the centroid of the returned rows.
   */
  static async searchStationsByLocation(
    query: string,
    placeId?: string,
    onResolved?: (label: string, center?: { lat: number; lng: number }) => void
  ): Promise<ChargingStation[]> {
    try {
      const normalized = query.trim().replace(/\s+/g, ' ');
      if (!normalized && !placeId) return [];

      const stations = await fetchStations(
        { mode: 'search', q: normalized, placeId },
        (headers) => {
          if (!onResolved) return;
          const resolved = headers.get('X-Ampo-Resolved-Place');
          if (!resolved) return;
          const rawCenter = headers.get('X-Ampo-Place-Center') ?? '';
          const [lat, lng] = rawCenter.split(',').map(Number);
          const center = Number.isFinite(lat) && Number.isFinite(lng)
            ? { lat, lng }
            : undefined;
          onResolved(decodeURIComponent(resolved), center);
        }
      );

      return stations.map(station => this.mapStation(station));
    } catch (error) {
      console.error('Error in searchStationsByLocation:', error);
      return [];
    }
  }

  /**
   * Search using the enriched dictionary fields (power, vehicle, connector, etc.).
   */
  static async searchStationsByFilters(filters: StationFilters, limit = 50): Promise<ChargingStation[]> {
    try {
      const stations = await fetchStations({ mode: 'filters', limit, ...filters });
      return stations.map(station => this.mapStation(station));
    } catch (error) {
      console.error('Error in searchStationsByFilters:', error);
      return [];
    }
  }

  /**
   * Sync stations from external data sources
   */
  static async syncStationsFromSources(): Promise<{ success: boolean; message: string }> {
    // Catalog refreshes are handled by the Vercel Cron in vercel.json.
    return { success: true, message: 'Station sync is scheduled server-side.' };
  }

  /**
   * Get stations within a bounding box
   */
  static async getStationsInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number): Promise<ChargingStation[]> {
    try {
      const stations = await fetchStations({
        mode: 'bounds', minLat, maxLat, minLng, maxLng,
      });
      return stations.map(station => this.mapStation(station));
    } catch (error) {
      console.error('Error in getStationsInBounds:', error);
      return [];
    }
  }

  /**
   * Get total number of stations by provider
   */
  static async getStationStats(): Promise<Record<string, number>> {
    try {
      const response = await fetch('/api/stations?mode=stats');
      if (!response.ok) return {};
      return await response.json() as Record<string, number>;
    } catch (error) {
      console.error('Error getting station stats:', error);
      return {};
    }
  }

  /** Latest state of a query-triggered Google gap-fill job. */
  static async getGoogleRefreshStatus(cell: string): Promise<GoogleRefreshInfo | null> {
    try {
      const response = await fetch(`/api/stations?mode=refresh-status&cell=${encodeURIComponent(cell)}`);
      if (!response.ok) return null;
      return await response.json() as GoogleRefreshInfo;
    } catch (error) {
      console.error('Error reading Google refresh status:', error);
      return null;
    }
  }

  /** Load one station for the detail page. */
  static async getStationById(id: string): Promise<ChargingStation | null> {
    try {
      const response = await fetch(`/api/stations?mode=id&id=${encodeURIComponent(id)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Station API failed: ${response.status}`);
      const row = await response.json() as StationRow;
      return this.mapStation(row);
    } catch (error) {
      console.error('Error in getStationById:', error);
      return null;
    }
  }

  /** Community reports for a station. `bust` skips the CDN copy after a new report. */
  static async getFeedback(stationId: string, bust = false): Promise<StationFeedback | null> {
    try {
      const suffix = bust ? `&_=${Date.now()}` : '';
      const response = await fetch(`/api/station-feedback?stationId=${encodeURIComponent(stationId)}${suffix}`, {
        cache: bust ? 'no-store' : 'default',
      });
      if (!response.ok) return null;
      return await response.json() as StationFeedback;
    } catch (error) {
      console.error('Error in getFeedback:', error);
      return null;
    }
  }

  static async submitFeedback(
    stationId: string,
    kind: 'working' | 'not_working' | 'wrong_location' | 'other',
    note: string
  ): Promise<boolean> {
    try {
      const response = await fetch('/api/station-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, kind, note }),
      });
      return response.ok;
    } catch (error) {
      console.error('Error in submitFeedback:', error);
      return false;
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private static calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Map database availability status to frontend status
   */
  private static mapAvailabilityStatus(status: string | null): StationStatus {
    switch (status?.toLowerCase()) {
      case 'available':
      case 'operational':
        return 'operational';
      case 'maintenance':
      case 'under_maintenance':
      case 'planned':
      case 'suspended':
        return 'maintenance';
      case 'out_of_service':
      case 'outofservice':
      case 'offline':
      case 'unavailable':
      case 'out of service':
      case 'inoperative':
      case 'removed':
        return 'out-of-service';
      default:
        return 'operational';
    }
  }
}
