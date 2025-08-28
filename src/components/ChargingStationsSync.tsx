import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ChargingStationsSync as SyncService, SyncResult } from '@/services/chargingStationsSync';
import { Loader2, Download, MapPin, Database } from 'lucide-react';

interface ChargingStationsSyncProps {
  userLocation?: { lat: number; lng: number } | null;
  onSyncComplete?: () => void;
}

export const ChargingStationsSync: React.FC<ChargingStationsSyncProps> = ({
  userLocation,
  onSyncComplete
}) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const handleSync = async () => {
    if (!userLocation) {
      toast({
        title: "Location Required",
        description: "Please enable location services to sync nearby stations",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await SyncService.fetchAndSyncStations(
        userLocation.lat,
        userLocation.lng,
        100 // 100km radius for comprehensive coverage
      );

      setLastSyncResult(result);

      if (result.success) {
        toast({
          title: "Sync Successful",
          description: `Found ${result.stats?.new || 0} new stations from ${result.networks_found?.length || 0} networks`,
        });
        onSyncComplete?.();
      } else {
        toast({
          title: "Sync Failed",
          description: result.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Sync Error",
        description: "Failed to sync charging stations",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Database className="w-5 h-5" />
          <span>Sync Charging Networks</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Fetch the latest charging stations from Bolt.earth, HPCL, BPCL, Hyundai, and other networks through Open Charge Map.
        </div>
        
        <Button
          onClick={handleSync}
          disabled={isLoading || !userLocation}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Sync Charging Stations
            </>
          )}
        </Button>

        {!userLocation && (
          <div className="flex items-center space-x-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
            <MapPin className="w-4 h-4" />
            <span>Location access needed to sync nearby stations</span>
          </div>
        )}

        {lastSyncResult && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm">
            <div className="font-medium mb-2">Last Sync Results:</div>
            {lastSyncResult.success ? (
              <div className="space-y-1 text-green-700">
                <div>✓ Fetched: {lastSyncResult.stats?.fetched || 0} stations</div>
                <div>✓ New: {lastSyncResult.stats?.new || 0} stations added</div>
                <div>✓ Networks: {lastSyncResult.networks_found?.join(', ')}</div>
              </div>
            ) : (
              <div className="text-red-600">
                ✗ Error: {lastSyncResult.error}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};