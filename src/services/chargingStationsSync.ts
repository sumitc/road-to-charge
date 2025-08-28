import { supabase } from '@/integrations/supabase/client';

export interface SyncResult {
  success: boolean;
  message?: string;
  stats?: {
    fetched: number;
    new: number;
    existing: number;
  };
  networks_found?: string[];
  error?: string;
}

export class ChargingStationsSync {
  static async fetchAndSyncStations(
    latitude: number, 
    longitude: number, 
    radius: number = 50
  ): Promise<SyncResult> {
    try {
      console.log(`Syncing charging stations for location ${latitude}, ${longitude}`);
      
      const { data, error } = await supabase.functions.invoke('fetch-charging-stations', {
        body: {
          latitude,
          longitude,
          radius
        }
      });

      if (error) {
        console.error('Error calling fetch-charging-stations function:', error);
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || 'Unknown error occurred');
      }

      console.log('Sync completed successfully:', data);
      return data;

    } catch (error) {
      console.error('Error syncing charging stations:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  static async getAvailableNetworks(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('ev_charging_stations')
        .select('provider')
        .order('provider');

      if (error) {
        console.error('Error fetching providers:', error);
        return [];
      }

      // Get unique providers
      const uniqueProviders = [...new Set(data.map(station => station.provider))];
      return uniqueProviders.sort();

    } catch (error) {
      console.error('Error getting available networks:', error);
      return [];
    }
  }
}