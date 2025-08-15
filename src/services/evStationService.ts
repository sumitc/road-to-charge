import { supabase } from '@/integrations/supabase/client';
import type { ChargingStation, UserLocation } from '@/types/station';

export class EVStationService {
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
      const stationsWithDistance = stations
        .map(station => {
          const distance = this.calculateDistance(
            userLocation.lat,
            userLocation.lng,
            parseFloat(station.latitude.toString()),
            parseFloat(station.longitude.toString())
          );
          
          return {
            id: station.id,
            name: station.station_name,
            provider: station.provider,
            address: station.address,
            lat: parseFloat(station.latitude.toString()),
            lng: parseFloat(station.longitude.toString()),
            distance,
            status: this.mapAvailabilityStatus(station.availability_status),
            connectorTypes: station.connector_types || [],
            powerOutput: station.power_output,
            pricing: station.pricing
          } as ChargingStation;
        })
        .filter(station => station.distance <= radius)
        .sort((a, b) => a.distance - b.distance);

      return stationsWithDistance;
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
      const { data: stations, error } = await supabase
        .from('ev_charging_stations')
        .select('*')
        .or(`station_name.ilike.%${query}%,address.ilike.%${query}%,provider.ilike.%${query}%`)
        .order('station_name')
        .limit(50);

      if (error) {
        console.error('Error searching stations:', error);
        return [];
      }

      if (!stations) return [];

      return stations.map(station => ({
        id: station.id,
        name: station.station_name,
        provider: station.provider,
        address: station.address,
        lat: parseFloat(station.latitude.toString()),
        lng: parseFloat(station.longitude.toString()),
        distance: 0, // Will be calculated on frontend if needed
        status: this.mapAvailabilityStatus(station.availability_status),
        connectorTypes: station.connector_types || [],
        powerOutput: station.power_output,
        pricing: station.pricing
      } as ChargingStation));
    } catch (error) {
      console.error('Error in searchStationsByLocation:', error);
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
  private static mapAvailabilityStatus(status: string | null): 'operational' | 'maintenance' | 'out-of-service' {
    switch (status?.toLowerCase()) {
      case 'available':
      case 'operational':
        return 'operational';
      case 'maintenance':
      case 'under_maintenance':
        return 'maintenance';
      case 'out_of_service':
      case 'offline':
      case 'unavailable':
        return 'out-of-service';
      default:
        return 'operational';
    }
  }
}