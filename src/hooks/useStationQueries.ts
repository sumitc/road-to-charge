import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EVStationService } from '@/services/evStationService';
import { LocationService } from '@/services/locationService';
import type { ChargingStation, UserLocation } from '@/types/station';

const FIVE_MINUTES = 5 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;

export const stationKeys = {
  nearby: (location: UserLocation, radius: number) =>
    [
      'stations',
      'nearby',
      Number(location.lat.toFixed(4)),
      Number(location.lng.toFixed(4)),
      radius,
    ] as const,
  search: (query: string, placeId?: string) =>
    ['stations', 'search', query.trim().toLowerCase(), placeId ?? ''] as const,
  // Exact Google place centre for a search, cached with it so detail→back
  // cache hits still centre distances on the chosen place, not the row centroid.
  searchCenter: (query: string, placeId?: string) =>
    ['stations', 'search-center', query.trim().toLowerCase(), placeId ?? ''] as const,
  detail: (id: string) => ['station', id] as const,
  feedback: (id: string) => ['station-feedback', id] as const,
};

/** Location is cached in memory across route changes and in storage across launches. */
export function useUserLocation() {
  const cached = LocationService.getCachedLocation();
  return useQuery<UserLocation>({
    queryKey: ['user-location'],
    queryFn: async () => {
      const resolved = await LocationService.getCurrentLocation();
      // A denied/timed-out GPS lookup must never replace a real cached
      // location with the Delhi fallback (that made every refresh load Delhi
      // and made the list refetch for it forever). Keep the last real fix if
      // we have one; only persist genuine GPS results. A first-time visitor
      // with no cache can still see the fallback for this session, but it is
      // intentionally not written to storage.
      if (resolved.isFallback) {
        return cached?.location ?? resolved.location;
      }
      LocationService.saveLocation(resolved.location);
      return resolved.location;
    },
    initialData: cached?.location,
    initialDataUpdatedAt: cached?.timestamp ?? 0,
    staleTime: FIVE_MINUTES,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Return to the device's CURRENT location and force nearby stations to reload.
 * Shared by "Show Nearby", the Ampo wordmark and the logo icon so every home
 * affordance behaves identically. A denied/timed-out GPS lookup falls back to
 * the last real cached fix — never the Delhi display fallback.
 */
export function useGoToCurrentLocation() {
  const queryClient = useQueryClient();
  const [isLocating, setIsLocating] = useState(false);

  const goToCurrentLocation = useCallback(async (): Promise<UserLocation> => {
    setIsLocating(true);
    try {
      const resolved = await LocationService.getCurrentLocation();
      const cached = LocationService.getCachedLocation()?.location;
      const current = resolved.isFallback ? (cached ?? resolved.location) : resolved.location;
      if (!resolved.isFallback) LocationService.saveLocation(current);
      queryClient.setQueryData(['user-location'], current);
      // Force a fresh fetch instead of trusting a cache entry from the
      // searched area. Only the active query needs it — 'all' would refetch
      // every location ever cached during past searches.
      await queryClient.invalidateQueries({
        queryKey: ['stations', 'nearby'],
        refetchType: 'active',
      });
      return current;
    } finally {
      setIsLocating(false);
    }
  }, [queryClient]);

  return { goToCurrentLocation, isLocating };
}

export function useNearbyStations(location: UserLocation | null, radius: number) {
  return useQuery({
    queryKey: location ? stationKeys.nearby(location, radius) : ['stations', 'nearby', 'none'],
    queryFn: () => EVStationService.getStationsWithDistance(location!, radius),
    enabled: Boolean(location),
    staleTime: FIVE_MINUTES,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useStationSearch(query: string, placeId?: string) {
  return useQuery({
    queryKey: stationKeys.search(query, placeId),
    queryFn: () => EVStationService.searchStationsByLocation(query, placeId),
    enabled: Boolean(query.trim()),
    staleTime: TEN_MINUTES,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useStationDetail(id: string) {
  return useQuery({
    queryKey: stationKeys.detail(id),
    queryFn: () => EVStationService.getStationById(id),
    enabled: Boolean(id),
    staleTime: FIVE_MINUTES,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useStationFeedback(id: string | undefined) {
  return useQuery({
    queryKey: stationKeys.feedback(id ?? 'none'),
    queryFn: () => EVStationService.getFeedback(id!),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

/**
 * Called on touch/hover of a station card. Seeds the detail cache with the row
 * we already have from the list so the detail page paints instantly, then
 * warms the full station + feedback queries in the background.
 */
export function usePrefetchStation() {
  const queryClient = useQueryClient();
  return useCallback((station: ChargingStation) => {
    const detailKey = stationKeys.detail(station.id);
    queryClient.setQueryData(detailKey, station, { updatedAt: 0 });
    void queryClient.prefetchQuery({
      queryKey: detailKey,
      queryFn: () => EVStationService.getStationById(station.id),
      staleTime: 0,
    });
    void queryClient.prefetchQuery({
      queryKey: stationKeys.feedback(station.id),
      queryFn: () => EVStationService.getFeedback(station.id),
      staleTime: 60 * 1000,
    });
  }, [queryClient]);
}
