import React, { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MapPin, Star, Zap, RefreshCw, Route } from 'lucide-react';
import { BrandTitle } from './BrandTitle';
import { SiteFooter } from './SiteFooter';
import { NearbyStations } from './NearbyStations';
import { FavouriteStations } from './FavouriteStations';
import { ContributionButton } from './ContributionButton';
import { GoogleRefreshNotice } from './GoogleRefreshNotice';
import { ChargingStationsSync as ChargingStationsSyncService } from '@/services/chargingStationsSync';
import { useGoToCurrentLocation, useUserLocation } from '@/hooks/useStationQueries';
import { useToast } from '@/hooks/use-toast';

// Only loaded when the Trips tab is opened (or warmed on hover/focus).
const loadTripPlanner = () => import('./TripPlanner');
const TripPlanner = lazy(loadTripPlanner);

function TripPlannerSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading trip planner">
      <div className="h-72 animate-pulse rounded-2xl bg-muted/60 sm:h-64" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  );
}

export const EVApp = () => {
  const queryClient = useQueryClient();
  // Cached in React Query across routes and in localStorage across launches,
  // so returning from a detail page never re-runs geolocation.
  const { data: location, isLoading: isLoadingLocation } = useUserLocation();
  const { goToCurrentLocation } = useGoToCurrentLocation();
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const handleLocationUpdate = (next: { lat: number; lng: number }) => {
    // Searching another city only moves the active list/map centre for this
    // session. Never persist it as the user's home location — doing so made a
    // search for Delhi replace the real GPS location in localStorage forever.
    queryClient.setQueryData(['user-location'], next);
  };

  // The wordmark and logo icon are home affordances: behave exactly like
  // "Show Nearby" — re-read the device location and reload nearby stations.
  const handleHomeClick = () => {
    void goToCurrentLocation();
  };

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
        // Refetch station lists instead of a full page reload so the cached
        // location and UI state survive.
        await queryClient.invalidateQueries({ queryKey: ['stations'] });
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

  return (
    <div className="min-h-screen bg-background" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header
        className="bg-gradient-hero text-primary-foreground px-3 py-2.5 shadow-electric sm:px-4 sm:py-4"
        style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}
      >
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Link
                to="/"
                onClick={handleHomeClick}
                aria-label="Ampo logo — back to nearby"
                className="shrink-0 rounded-lg bg-primary-foreground/20 p-1.5 sm:p-2"
              >
                <Zap className="w-4 h-4 sm:w-6 sm:h-6" />
              </Link>
              <div className="min-w-0">
                <BrandTitle subtitle="EV station finder" onClick={handleHomeClick} />
              </div>
            </div>
            <Button 
              onClick={handleSync} 
              disabled={isSyncing}
              variant="outline" 
              size="sm"
              aria-label={isSyncing ? 'Syncing station data' : 'Sync station data'}
              className="h-9 min-h-0 shrink-0 bg-primary-foreground/20 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/30 sm:h-10 sm:min-h-[44px]"
            >
              <RefreshCw className={`w-4 h-4 sm:mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Data'}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className="max-w-4xl mx-auto px-3 pt-2 pb-8 sm:p-4"
        style={{ paddingBottom: 'calc(2rem + var(--ampo-banner-height, 0px))' }}
      >
        <Tabs defaultValue="nearby" className="space-y-3 sm:space-y-6">
          <TabsList className="grid !h-auto w-full grid-cols-3 bg-card shadow-sm sm:!h-10">
            <TabsTrigger
              value="nearby"
              className="flex min-h-[44px] flex-col gap-1 px-1 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
            >
              <MapPin className="w-4 h-4" />
              <span className="sm:hidden">Stations</span>
              <span className="hidden sm:inline">Find Stations</span>
            </TabsTrigger>
            <TabsTrigger
              value="trip"
              onPointerEnter={loadTripPlanner}
              onFocus={loadTripPlanner}
              className="flex min-h-[44px] flex-col gap-1 px-1 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
            >
              <Route className="w-4 h-4" />
              <span className="sm:hidden">Trips</span>
              <span className="hidden sm:inline">Trip Planner</span>
            </TabsTrigger>
            <TabsTrigger
              value="favourites"
              className="flex min-h-[44px] flex-col gap-1 px-1 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
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
              onLocationUpdate={handleLocationUpdate}
            />
          </TabsContent>

          <TabsContent value="trip" className="space-y-4">
            <Suspense fallback={<TripPlannerSkeleton />}>
              <TripPlanner />
            </Suspense>
          </TabsContent>

          <TabsContent value="favourites" className="space-y-4">
            <FavouriteStations />
          </TabsContent>
        </Tabs>
        <SiteFooter />
      </main>

      <ContributionButton location={location} />
      <GoogleRefreshNotice />
    </div>
  );
};