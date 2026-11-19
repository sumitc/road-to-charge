import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MapPin, Search, Star, Zap, RefreshCw, Database, Route } from 'lucide-react';
import { NearbyStations } from './NearbyStations';
import { FavouriteStations } from './FavouriteStations';
import { ChargingStationsSync } from './ChargingStationsSync';
import TripPlanner from './TripPlanner';
import { LocationService } from '@/services/locationService';
import { ChargingStationsSync as ChargingStationsSyncService } from '@/services/chargingStationsSync';
import { useToast } from '@/hooks/use-toast';

export const EVApp = () => {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const handleSync = async () => {
    if (!location) {
      toast({
        title: "Location required",
        description: "Enable location to sync nearby stations",
        variant: "destructive",
      });
      return;
    }

    setIsSyncing(true);
    try {
      const result = await ChargingStationsSyncService.fetchAndSyncStations(
        location.lat,
        location.lng,
        100
      );

      if (result.success) {
        toast({
          title: "Sync successful",
          description: `Added ${result.stats?.new || 0} new stations`,
        });
        window.location.reload();
      } else {
        toast({
          title: "Sync failed",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Sync error",
        description: "Failed to sync station data",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

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
    <div className="min-h-screen bg-background" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header
        className="bg-gradient-hero text-primary-foreground px-3 py-4 shadow-electric sm:px-4"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="shrink-0 p-2 bg-primary-foreground/20 rounded-lg">
                <Zap className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold">EV Station Finder</h1>
                <p className="text-xs sm:text-sm opacity-90">Find charging stations near you</p>
              </div>
            </div>
            <Button 
              onClick={handleSync} 
              disabled={isSyncing}
              variant="outline" 
              size="sm"
              aria-label={isSyncing ? 'Syncing station data' : 'Sync station data'}
              className="shrink-0 min-h-[44px] bg-primary-foreground/20 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/30"
            >
              <RefreshCw className={`w-4 h-4 sm:mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Data'}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className="max-w-4xl mx-auto px-3 pt-4 pb-8 sm:p-4"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Tabs defaultValue="nearby" className="space-y-6">
          <TabsList className="grid !h-auto w-full grid-cols-3 bg-card shadow-sm sm:!h-10">
            <TabsTrigger
              value="nearby"
              className="flex min-h-[56px] flex-col gap-1 px-1 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
            >
              <MapPin className="w-4 h-4" />
              <span className="sm:hidden">Stations</span>
              <span className="hidden sm:inline">Find Stations</span>
            </TabsTrigger>
            <TabsTrigger
              value="trip"
              className="flex min-h-[56px] flex-col gap-1 px-1 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
            >
              <Route className="w-4 h-4" />
              <span className="sm:hidden">Trips</span>
              <span className="hidden sm:inline">Trip Planner</span>
            </TabsTrigger>
            <TabsTrigger
              value="favourites"
              className="flex min-h-[56px] flex-col gap-1 px-1 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
            >
              <Star className="w-4 h-4" />
              <span className="sm:hidden">Saved</span>
              <span className="hidden sm:inline">Favourites</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="nearby" className="space-y-4">
            <NearbyStations 
              location={location} 
              isLoadingLocation={isLoadingLocation}
              onLocationUpdate={setLocation}
            />
          </TabsContent>

          <TabsContent value="trip" className="space-y-4">
            <TripPlanner />
          </TabsContent>

          <TabsContent value="favourites" className="space-y-4">
            <FavouriteStations />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};