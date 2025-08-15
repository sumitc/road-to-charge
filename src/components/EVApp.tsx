import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, Search, Star, Zap } from 'lucide-react';
import { NearbyStations } from './NearbyStations';
import { SearchStations } from './SearchStations';
import { FavouriteStations } from './FavouriteStations';
import { LocationService } from '@/services/locationService';
import { useToast } from '@/hooks/use-toast';

export const EVApp = () => {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const getLocation = async () => {
      try {
        setIsLoadingLocation(true);
        const userLocation = await LocationService.getCurrentLocation();
        setLocation(userLocation);
        toast({
          title: "Location detected",
          description: "Finding nearby charging stations...",
        });
      } catch (error) {
        toast({
          title: "Location not available",
          description: "Using default location. You can search manually.",
          variant: "destructive",
        });
        // Default to a central location if geolocation fails
        setLocation({ lat: 28.6139, lng: 77.2090 }); // Delhi
      } finally {
        setIsLoadingLocation(false);
      }
    };

    getLocation();
  }, [toast]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-gradient-hero text-primary-foreground p-4 shadow-electric">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary-foreground/20 rounded-lg">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">EV Station Finder</h1>
              <p className="text-sm opacity-90">Find charging stations near you</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-4">
        <Tabs defaultValue="nearby" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-card shadow-sm">
            <TabsTrigger value="nearby" className="flex items-center space-x-2">
              <MapPin className="w-4 h-4" />
              <span>Nearby</span>
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center space-x-2">
              <Search className="w-4 h-4" />
              <span>Search</span>
            </TabsTrigger>
            <TabsTrigger value="favourites" className="flex items-center space-x-2">
              <Star className="w-4 h-4" />
              <span>Favourites</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="nearby" className="space-y-4">
            <NearbyStations location={location} isLoadingLocation={isLoadingLocation} />
          </TabsContent>

          <TabsContent value="search" className="space-y-4">
            <SearchStations onLocationUpdate={setLocation} />
          </TabsContent>

          <TabsContent value="favourites" className="space-y-4">
            <FavouriteStations />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};