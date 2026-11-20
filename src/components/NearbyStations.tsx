import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, AlertCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StationCard } from './StationCard';
import { ConnectorFilter } from './ConnectorFilter';
import { ChargingStation } from '@/types/station';
import { EVStationService } from '@/services/evStationService';
import { stationKeys, useNearbyStations } from '@/hooks/useStationQueries';
import { matchesConnectorFilters } from '@/lib/connectorLabels';
import { useToast } from '@/hooks/use-toast';

interface NearbyStationsProps {
  location: { lat: number; lng: number } | null;
  isLoadingLocation: boolean;
  onLocationUpdate: (location: { lat: number; lng: number }) => void;
}

export const NearbyStations: React.FC<NearbyStationsProps> = ({
  location,
  isLoadingLocation,
  onLocationUpdate,
}) => {
  const queryClient = useQueryClient();
  const [radius, setRadius] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchResults, setSearchResults] = useState<ChargingStation[]>([]);
  const [connectorFilters, setConnectorFilters] = useState<string[]>([]);
  const syncedFor = useRef<string | null>(null);
  const { toast } = useToast();

  // Cached by location + radius, so detail→back never refetches the list.
  const nearbyQuery = useNearbyStations(location, radius);
  const nearbyStations = nearbyQuery.data ?? [];
  // Only block the list on a first load; keep cached rows visible during a
  // background refresh so detail→back feels instant.
  const isLoading = nearbyQuery.isPending;

  const stations = showSearchResults ? searchResults : nearbyStations;
  const visibleStations = stations.filter(station =>
    matchesConnectorFilters(station.connectorTypes, connectorFilters)
  );

  // Only sync once per area if the catalog happens to be empty.
  useEffect(() => {
    if (showSearchResults || !location || nearbyQuery.isFetching || nearbyStations.length > 0) return;
    const key = `${location.lat.toFixed(3)},${location.lng.toFixed(3)},${radius}`;
    if (syncedFor.current === key) return;
    syncedFor.current = key;
    EVStationService.syncStationsFromSources()
      .then(() => queryClient.invalidateQueries({ queryKey: ['stations'] }))
      .catch(() => undefined);
  }, [showSearchResults, location, nearbyQuery.isFetching, nearbyStations.length, radius, queryClient]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Please enter a location",
        description: "Try an area and city, like 'Koramangala, Bangalore'",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setShowSearchResults(true);

    try {
      const normalizedQuery = searchQuery.trim();
      const results = await queryClient.fetchQuery({
        queryKey: stationKeys.search(normalizedQuery),
        queryFn: () => EVStationService.searchStationsByLocation(normalizedQuery),
        staleTime: 10 * 60 * 1000,
      });
      setSearchResults(results);

      // Move the nearby map centre to the searched area (cached for Show Nearby).
      if (results.length > 0) {
        const avgLat = results.reduce((sum, station) => sum + station.lat, 0) / results.length;
        const avgLng = results.reduce((sum, station) => sum + station.lng, 0) / results.length;
        onLocationUpdate({ lat: avgLat, lng: avgLng });
      }

      toast({
        title: "Search completed",
        description: `Found ${results.length} stations for "${normalizedQuery}"`,
      });
    } catch (error) {
      toast({
        title: "Search failed",
        description: "Could not search for stations. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleShowNearby = () => {
    setShowSearchResults(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  if (isLoadingLocation) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <Loader2 className="w-7 h-7 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Detecting your location...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!location) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <AlertCircle className="w-7 h-7 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">Location not available</p>
            <p className="text-xs text-muted-foreground">
              Search by area or city to find stations manually
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search Bar */}
      <Card className="rounded-2xl">
        <CardContent className="p-3 sm:p-4">
          <div className="flex gap-2 mb-2.5">
            <Input
              placeholder="e.g. 'Koramangala, Bangalore' or 'Indiranagar Bangalore'"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              className="min-w-0 flex-1 min-h-[44px]"
              aria-label="Search for charging stations by area or city"
            />
            <Button
              onClick={handleSearch}
              disabled={isSearching}
              aria-label="Search"
              className="shrink-0 min-h-[44px] px-3 bg-gradient-primary hover:opacity-90"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-between">
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {showSearchResults && <MapPin className="w-4 h-4 shrink-0 text-primary" />}
              {showSearchResults ? (
                `Search results for "${searchQuery}"`
              ) : (
                <>
                  <span className="sm:hidden">Within</span>
                  <span className="hidden sm:inline">Nearby stations within</span>
                </>
              )}
            </span>

            {/* Distance and connector sit side by side on mobile. */}
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              {showSearchResults ? (
                <>
                  <ConnectorFilter
                    selected={connectorFilters}
                    onChange={setConnectorFilters}
                    className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShowNearby}
                    className="h-10 min-h-0 shrink-0"
                  >
                    Show Nearby
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                    <MapPin className="w-4 h-4 shrink-0 text-primary" />
                    <select
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      aria-label="Search radius in kilometres"
                      className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm sm:w-28 sm:flex-none"
                    >
                      <option value={5}>5 km</option>
                      <option value={10}>10 km</option>
                      <option value={25}>25 km</option>
                      <option value={50}>50 km</option>
                    </select>
                  </div>
                  <ConnectorFilter
                    selected={connectorFilters}
                    onChange={setConnectorFilters}
                    className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                  />
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading state — kept slim so results stay visible on mobile. */}
      {(nearbyQuery.isFetching || isSearching) && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {isSearching ? 'Searching stations…' : 'Finding nearby stations…'}
        </div>
      )}

      {/* Results */}
      {!isLoading && !isSearching && (
        <>
          {visibleStations.length > 0 ? (
            <div className="space-y-3">
              <p className="hidden text-sm text-muted-foreground sm:block">
                Found {visibleStations.length} station{visibleStations.length !== 1 ? 's' : ''}
                {connectorFilters.length > 0 ? ' matching your selection' : ' near you'}
              </p>
              {visibleStations.map((station) => (
                <StationCard key={station.id} station={station} userLocation={location} />
              ))}
            </div>
          ) : stations.length > 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="flex items-center justify-center p-6">
                <div className="text-center space-y-2">
                  <AlertCircle className="w-7 h-7 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No stations match your selection</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => setConnectorFilters([])}
                  >
                    Show all connectors
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl">
              <CardContent className="flex items-center justify-center p-6">
                <div className="text-center space-y-2">
                  <AlertCircle className="w-7 h-7 text-muted-foreground mx-auto" />
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
