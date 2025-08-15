import React, { useState, useEffect } from 'react';
import { Loader2, MapPin, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StationCard } from './StationCard';
import { ChargingStation } from '@/types/station';
import { getStationsWithDistance } from '@/data/mockStations';

interface NearbyStationsProps {
  location: { lat: number; lng: number } | null;
  isLoadingLocation: boolean;
}

export const NearbyStations: React.FC<NearbyStationsProps> = ({ 
  location, 
  isLoadingLocation 
}) => {
  const [stations, setStations] = useState<ChargingStation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [radius, setRadius] = useState(10);

  useEffect(() => {
    if (location && !isLoadingLocation) {
      loadNearbyStations();
    }
  }, [location, isLoadingLocation, radius]);

  const loadNearbyStations = async () => {
    if (!location) return;
    
    setIsLoading(true);
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      const nearbyStations = getStationsWithDistance(location, radius);
      setStations(nearbyStations);
    } catch (error) {
      console.error('Error loading stations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    loadNearbyStations();
  };

  if (isLoadingLocation) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <div className="text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Detecting your location...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!location) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <div className="text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-muted-foreground">Location not available</p>
            <p className="text-sm text-muted-foreground">
              Please use the Search tab to find stations manually
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MapPin className="w-5 h-5 text-primary" />
              <span className="text-sm text-muted-foreground">
                Within {radius} km
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="px-3 py-2 text-sm border border-input bg-background rounded-md"
              >
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={25}>25 km</option>
                <option value={50}>50 km</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Refresh'
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center p-8">
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground">Finding charging stations...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {!isLoading && (
        <>
          {stations.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Found {stations.length} station{stations.length !== 1 ? 's' : ''} near you
              </p>
              {stations.map((station) => (
                <StationCard
                  key={station.id}
                  station={station}
                  userLocation={location}
                  onFavouriteToggle={loadNearbyStations}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center p-8">
                <div className="text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No charging stations found</p>
                  <p className="text-sm text-muted-foreground">
                    Try increasing the search radius or check your location
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};