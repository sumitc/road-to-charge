import React, { useState, useEffect } from 'react';
import { Loader2, MapPin, AlertCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StationCard } from './StationCard';
import { ChargingStation } from '@/types/station';
import { EVStationService } from '@/services/evStationService';
import {
  CONNECTOR_FILTER_OPTIONS,
  matchesConnectorFilter,
} from '@/lib/connectorLabels';
import { useToast } from '@/hooks/use-toast';

interface NearbyStationsProps {
  location: { lat: number; lng: number } | null;
  isLoadingLocation: boolean;
  onLocationUpdate: (location: { lat: number; lng: number }) => void;
}

export const NearbyStations: React.FC<NearbyStationsProps> = ({ 
  location, 
  isLoadingLocation,
  onLocationUpdate 
}) => {
  const [stations, setStations] = useState<ChargingStation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [radius, setRadius] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [connectorFilter, setConnectorFilter] = useState('all');
  const { toast } = useToast();

  const visibleStations = connectorFilter === 'all'
    ? stations
    : stations.filter(station => matchesConnectorFilter(station.connectorTypes, connectorFilter));

  useEffect(() => {
    if (location && !isLoadingLocation) {
      loadNearbyStations();
    }
  }, [location, isLoadingLocation, radius]);

  const loadNearbyStations = async () => {
    if (!location) return;
    
    setIsLoading(true);
    try {
      // Try to sync stations first if database is empty
      const stations = await EVStationService.getStationsWithDistance(location, radius);
      if (stations.length === 0) {
        console.log('No stations found, triggering sync...');
        await EVStationService.syncStationsFromSources();
        // Try again after sync
        const syncedStations = await EVStationService.getStationsWithDistance(location, radius);
        setStations(syncedStations);
      } else {
        setStations(stations);
      }
    } catch (error) {
      console.error('Error loading stations:', error);
      setStations([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    if (showSearchResults) {
      handleSearch();
    } else {
      loadNearbyStations();
    }
  };

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
      // Search for stations based on query
      const results = await EVStationService.searchStationsByLocation(normalizedQuery);
      setStations(results);
      
      // Update location based on search results
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
      {/* Search Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex space-x-2 mb-4">
            <Input
              placeholder="e.g. 'Koramangala, Bangalore' or 'Indiranagar Bangalore'"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1"
            />
            <Button 
              onClick={handleSearch} 
              disabled={isSearching}
              className="bg-gradient-primary hover:opacity-90"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="-mt-2 mb-4 text-xs text-muted-foreground">
            Enter an area, city, or both. Commas or spaces both work.
          </p>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MapPin className="w-5 h-5 text-primary" />
              <span className="text-sm text-muted-foreground">
                {showSearchResults ? `Search results for "${searchQuery}"` : `Nearby stations within ${radius} km`}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              {showSearchResults ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShowNearby}
                >
                  Show Nearby
                </Button>
              ) : (
                <>
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
                    disabled={isLoading || isSearching}
                  >
                    {(isLoading || isSearching) ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Refresh'
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connector filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Label>Connector / charging speed</Label>
              <p className="text-xs text-muted-foreground">
                Slow = AC, Fast/Super-fast = DC. Pick the plug you need.
              </p>
            </div>
            <Select value={connectorFilter} onValueChange={setConnectorFilter}>
              <SelectTrigger className="w-full sm:w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONNECTOR_FILTER_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {(isLoading || isSearching) && (
        <Card>
          <CardContent className="flex items-center justify-center p-8">
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground">
                {isSearching ? 'Searching for charging stations...' : 'Finding nearby charging stations...'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {!isLoading && !isSearching && (
        <>
          {visibleStations.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Found {visibleStations.length} station{visibleStations.length !== 1 ? 's' : ''}
                {connectorFilter !== 'all' ? ' matching this connector' : ' near you'}
              </p>
              {visibleStations.map((station) => (
                <StationCard
                  key={station.id}
                  station={station}
                  userLocation={location}
                  onFavouriteToggle={loadNearbyStations}
                />
              ))}
            </div>
          ) : stations.length > 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center p-8">
                <div className="text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No stations match this connector</p>
                  <Button variant="outline" size="sm" onClick={() => setConnectorFilter('all')}>
                    Show all connectors
                  </Button>
                </div>
              </CardContent>
            </Card>
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