import React, { useState } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StationCard } from './StationCard';
import { ChargingStation } from '@/types/station';
import { searchStationsByLocation } from '@/data/mockStations';
import { useToast } from '@/hooks/use-toast';

interface SearchStationsProps {
  onLocationUpdate: (location: { lat: number; lng: number }) => void;
}

export const SearchStations: React.FC<SearchStationsProps> = ({ onLocationUpdate }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [stations, setStations] = useState<ChargingStation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Please enter a location",
        description: "Enter a city, address, or trip plan to search",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      // Search for stations based on query
      const results = await searchStationsByLocation(searchQuery);
      setStations(results);
      
      // Update location based on search results
      if (results.length > 0) {
        const avgLat = results.reduce((sum, station) => sum + station.lat, 0) / results.length;
        const avgLng = results.reduce((sum, station) => sum + station.lng, 0) / results.length;
        onLocationUpdate({ lat: avgLat, lng: avgLng });
      }

      toast({
        title: "Search completed",
        description: `Found ${results.length} stations for "${searchQuery}"`,
      });
    } catch (error) {
      toast({
        title: "Search failed",
        description: "Could not search for stations. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const exampleSearches = [
    "Delhi to Mumbai",
    "Bangalore charging stations",
    "From Hyderabad to Chennai via Vellore",
    "Gurgaon to Noida"
  ];

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            <div className="flex space-x-2">
              <Input
                placeholder="Enter location or trip plan (e.g., 'Delhi to Mumbai' or 'Bangalore')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1"
              />
              <Button 
                onClick={handleSearch} 
                disabled={isLoading}
                className="bg-gradient-primary hover:opacity-90"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Search
              </Button>
            </div>

            {/* Example searches */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Try these examples:</p>
              <div className="flex flex-wrap gap-2">
                {exampleSearches.map((example, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => setSearchQuery(example)}
                    className="text-xs"
                  >
                    {example}
                  </Button>
                ))}
              </div>
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
              <p className="text-muted-foreground">Searching for charging stations...</p>
              <p className="text-sm text-muted-foreground">
                Analyzing route and finding stations along the way
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {!isLoading && hasSearched && (
        <>
          {stations.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <MapPin className="w-5 h-5 text-primary" />
                <p className="text-sm text-muted-foreground">
                  Found {stations.length} stations for "{searchQuery}"
                </p>
              </div>
              {stations.map((station) => (
                <StationCard
                  key={station.id}
                  station={station}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center p-8">
                <div className="text-center space-y-3">
                  <Search className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">No stations found</p>
                  <p className="text-sm text-muted-foreground">
                    Try a different location or check your spelling
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Initial state */}
      {!hasSearched && !isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center p-8">
            <div className="text-center space-y-3">
              <Search className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">Search for charging stations</p>
              <p className="text-sm text-muted-foreground">
                Enter a location, address, or trip plan to find stations
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};