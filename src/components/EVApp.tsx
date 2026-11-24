import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { BedDouble, MapPin, Share2, Star, Zap, Route } from 'lucide-react';
import { BrandTitle } from './BrandTitle';
import { SiteFooter } from './SiteFooter';
import { NearbyStations } from './NearbyStations';
import { FavouriteStations } from './FavouriteStations';
import { ContributionButton } from './ContributionButton';
import { GoogleRefreshNotice } from './GoogleRefreshNotice';
import { useGoToCurrentLocation, useUserLocation } from '@/hooks/useStationQueries';
import { trackAmpo } from '@/lib/analytics';
import { shareAmpoLink, shareTargetForView } from '@/lib/shareLink';
import { useToast } from '@/hooks/use-toast';

// Only loaded when the Trips tab is opened (or warmed on hover/focus).
const loadTripPlanner = () => import('./TripPlanner');
const TripPlanner = lazy(loadTripPlanner);

// Local-only chunk: the Google Places seed JSON must never inflate the main
// station-finder entry, and is not requested at all when the tab is disabled.
const loadHotelsTab = () => import('./HotelsTab').then(module => ({ default: module.HotelsTab }));
const HotelsTab = lazy(loadHotelsTab);

// The Hotels tab is part of the published experience. The env var remains as an
// emergency opt-out for local debugging; production only omits it if explicitly
// set to "false".
const SHOW_HOTELS_TAB = import.meta.env.VITE_ENABLE_HOTELS_TAB !== 'false';

function TripPlannerSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading trip planner">
      <div className="h-72 animate-pulse rounded-2xl bg-muted/60 sm:h-64" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  );
}

function HotelsSkeleton() {
  return (
    <div className="space-y-3 px-3 pt-3" aria-label="Loading hotels">
      <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
      <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  );
}

export const EVApp = ({ initialTab }: { initialTab?: string } = {}) => {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const hasRouteParams = Boolean(searchParams.get('from')?.trim() && searchParams.get('to')?.trim());
  const [activeTab, setActiveTab] = useState(initialTab ?? (hasRouteParams ? 'trip' : 'nearby'));
  const previousRouteState = useRef({ initialTab, hasRouteParams });
  // Cached in React Query across routes and in localStorage across launches,
  // so returning from a detail page never re-runs geolocation.
  const { data: location, isLoading: isLoadingLocation } = useUserLocation();
  const { goToCurrentLocation } = useGoToCurrentLocation();
  const { toast } = useToast();

  // A ?from=&to= share link should land on the trip planner. A dedicated
  // /hotels route passes initialTab so the same app shell opens the index.
  // Only real transitions change the tab: ordinary ?q= search updates must not
  // yank the user out of Trips/Hotels while they are typing.
  useEffect(() => {
    const previous = previousRouteState.current;
    if (initialTab !== previous.initialTab || hasRouteParams !== previous.hasRouteParams) {
      setActiveTab(initialTab ?? (hasRouteParams ? 'trip' : 'nearby'));
    }
    previousRouteState.current = { initialTab, hasRouteParams };
  }, [initialTab, hasRouteParams]);

  const handleLocationUpdate = (next: { lat: number; lng: number }) => {
    // Searching another city only moves the active list/map centre for this
    // session. Never persist it as the user's home location — doing so made a
    // search for Delhi replace the real GPS location in localStorage forever.
    queryClient.setQueryData(['user-location'], next);
  };

  // The wordmark and logo icon are home affordances: behave exactly like
  // the home affordance — re-read the device location and reload nearby stations.
  const handleHomeClick = () => {
    void goToCurrentLocation();
    trackAmpo('show_nearby', { source: 'header' });
  };

  // Header share follows the active tab: the current search, planned route or
  // hotel index. Native share is used on mobile browsers; desktop copies.
  const handleShare = async () => {
    const target = shareTargetForView(activeTab, searchParams);
    if (!target) {
      toast({
        title: 'Plan a route first',
        description: 'Add a start and destination, then share the trip.',
      });
      return;
    }

    const result = await shareAmpoLink(target);
    if (result === 'cancelled') return;
    if (result === 'failed') {
      toast({ title: 'Could not share link', variant: 'destructive' });
      return;
    }

    const method = result === 'shared' ? 'native' : 'clipboard';
    if (target.surface === 'search') {
      trackAmpo('search_shared', {
        query: target.properties?.query ?? null,
        place_id: target.properties?.place_id ?? null,
        source: 'header',
        method,
      });
    } else {
      trackAmpo('link_shared', {
        surface: target.surface,
        method,
        ...target.properties,
      });
    }

    if (result === 'copied') {
      const label = target.surface === 'route' ? 'Route link'
        : target.surface === 'hotels' ? 'Hotel list link'
          : target.surface === 'search' ? 'Search link' : 'Ampo link';
      toast({ title: `${label} copied`, description: 'Share it with fellow EV riders' });
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
              onClick={() => void handleShare()}
              variant="outline"
              size="sm"
              aria-label="Share this view"
              className="h-9 min-h-0 shrink-0 bg-primary-foreground/20 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/30 sm:h-10 sm:min-h-[44px]"
            >
              <Share2 className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Share</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className="max-w-4xl mx-auto px-3 pt-2 pb-8 sm:p-4"
        style={{ paddingBottom: 'calc(2rem + var(--ampo-banner-height, 0px))' }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 sm:space-y-6">
          <TabsList className={`grid !h-auto w-full ${SHOW_HOTELS_TAB ? 'grid-cols-4' : 'grid-cols-3'} bg-card shadow-sm sm:!h-10`}>
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
            {SHOW_HOTELS_TAB && (
              <TabsTrigger
                value="hotels"
                onPointerEnter={loadHotelsTab}
                onFocus={loadHotelsTab}
                className="relative flex min-h-[44px] flex-col gap-1 px-1 text-[10px] sm:min-h-[40px] sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
              >
                <BedDouble className="w-4 h-4" />
                <span>Hotels</span>
                <span className="absolute right-1 top-1 rounded bg-emerald-600 px-1 text-[8px] font-bold leading-tight text-white sm:static sm:px-1.5 sm:text-[9px]">
                  NEW
                </span>
              </TabsTrigger>
            )}
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

          {SHOW_HOTELS_TAB && (
            <TabsContent value="hotels" className="space-y-4">
              <Suspense fallback={<HotelsSkeleton />}>
                <HotelsTab />
              </Suspense>
            </TabsContent>
          )}
        </Tabs>
        <SiteFooter />
      </main>

      <ContributionButton location={location} />
      <GoogleRefreshNotice />
    </div>
  );
};