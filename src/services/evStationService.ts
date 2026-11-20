import type { Tables } from '@/integrations/supabase/types';
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

/** Read stations through our direct-SQL API (Supabase REST is unavailable on this plan). */
const fetchStations = async (params: Record<string, string | number | undefined>): Promise<StationRow[]> => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const response = await fetch(`/api/stations?${search.toString()}`);
  if (!response.ok) throw new Error(`Stations API failed: ${response.status}`);
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

    return {
      id: station.id,
      name: station.station_name,
      provider: station.provider,
      address: station.address,
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
   * Search for stations by location query
   */
  static async searchStationsByLocation(query: string): Promise<ChargingStation[]> {
    try {
      const normalized = query.trim().replace(/\s+/g, ' ');
      if (!normalized) return [];

      const stations = await fetchStations({ mode: 'search', q: normalized });

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

  /** Community reports for a station. */
  static async getFeedback(stationId: string): Promise<StationFeedback | null> {
    try {
      const response = await fetch(`/api/station-feedback?stationId=${encodeURIComponent(stationId)}`);
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
