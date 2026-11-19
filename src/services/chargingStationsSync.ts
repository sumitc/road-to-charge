

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
      console.log(`Syncing charging stations near ${latitude}, ${longitude} (${radius}km)`);

      const response = await fetch('/api/sync-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude, radius }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Sync failed with status ${response.status}`);
      }

      const networks = data.sources
        ? Object.keys(data.sources).filter((key) => data.sources[key]?.stations > 0)
        : [];

      return {
        success: true,
        message: `Synced ${data.synced ?? 0} stations`,
        stats: {
          fetched: data.synced ?? 0,
          new: data.synced ?? 0,
          existing: 0,
        },
        networks_found: networks,
      };

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
      const response = await fetch('/api/stations?mode=stats');
      if (!response.ok) return [];
      const stats = await response.json() as Record<string, number>;
      return Object.keys(stats).sort();

    } catch (error) {
      console.error('Error getting available networks:', error);
      return [];
    }
  }
}