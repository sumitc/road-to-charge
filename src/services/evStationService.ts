import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type {
  ChargingCurrent,
  ChargingStation,
  ConnectorDetail,
  LocationQuality,
  Ownership,
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
      // Calculate bounding box for efficient querying
      const latRange = radius / 111.0; // Approximate km per degree latitude
      const lngRange = radius / (111.0 * Math.cos(userLocation.lat * Math.PI / 180));

      const { data: stations, error } = await supabase
        .from('ev_charging_stations')
        .select('*')
        .gte('latitude', userLocation.lat - latRange)
        .lte('latitude', userLocation.lat + latRange)
        .gte('longitude', userLocation.lng - lngRange)
        .lte('longitude', userLocation.lng + lngRange)
        .order('last_updated', { ascending: false });

      if (error) {
        console.error('Error fetching stations:', error);
        return [];
      }

      if (!stations) return [];

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

      const { data: stations, error } = await supabase
        .from('ev_charging_stations')
        .select('*')
        .or(`station_name.ilike.%${normalized}%,address.ilike.%${normalized}%,provider.ilike.%${normalized}%,city.ilike.%${normalized}%,state.ilike.%${normalized}%`)
        .order('station_name')
        .limit(50);

      if (error) {
        console.error('Error searching stations:', error);
        return [];
      }

      if (!stations) return [];

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
      let query = supabase.from('ev_charging_stations').select('*');

      if (filters.minPowerKw !== undefined) {
        query = query.gte('max_power_kw', filters.minPowerKw);
      }
      if (filters.vehicleClass) {
        query = query.contains('vehicle_classes', [filters.vehicleClass]);
      }
      if (filters.current) {
        query = query.ilike('charging_current', `%${filters.current}%`);
      }
      if (filters.connector) {
        // Every sync source mirrors connector standards into connector_types.
        query = query.contains('connector_types', [filters.connector]);
      }
      if (filters.state) {
        query = query.ilike('state', filters.state);
      }
      if (filters.city) {
        query = query.ilike('city', `%${filters.city}%`);
      }
      if (filters.ownership) {
        query = query.eq('ownership', filters.ownership);
      }
      if (filters.stationType) {
        query = query.eq('station_type', filters.stationType);
      }

      const { data: stations, error } = await query
        .order('max_power_kw', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error in filtered station search:', error);
        return [];
      }

      return (stations ?? []).map(station => this.mapStation(station));
    } catch (error) {
      console.error('Error in searchStationsByFilters:', error);
      return [];
    }
  }

  /**
   * Sync stations from external data sources
   */
  static async syncStationsFromSources(): Promise<{ success: boolean; message: string }> {
    try {
      const { data, error } = await supabase.functions.invoke('sync-ev-stations');

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error syncing stations:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get stations within a bounding box
   */
  static async getStationsInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number): Promise<ChargingStation[]> {
    try {
      const { data: stations, error } = await supabase
        .from('ev_charging_stations')
        .select('*')
        .gte('latitude', minLat)
        .lte('latitude', maxLat)
        .gte('longitude', minLng)
        .lte('longitude', maxLng)
        .order('last_updated', { ascending: false });

      if (error) {
        console.error('Error fetching stations in bounds:', error);
        return [];
      }

      if (!stations) return [];

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
      const { data: stations, error } = await supabase
        .from('ev_charging_stations')
        .select('provider');

      if (error || !stations) {
        return {};
      }

      const stats: Record<string, number> = {};
      stations.forEach(station => {
        stats[station.provider] = (stats[station.provider] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('Error getting station stats:', error);
      return {};
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
