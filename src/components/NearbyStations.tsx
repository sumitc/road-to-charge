import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Loader2, MapPin, AlertCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StationCard } from './StationCard';
import { ConnectorFilter } from './ConnectorFilter';
import { ChargingStation } from '@/types/station';
import { EVStationService, type PlaceSuggestion } from '@/services/evStationService';
import { stationKeys, useNearbyStations, usePrefetchStation } from '@/hooks/useStationQueries';
import { useDrivingDistances } from '@/hooks/useDrivingDistances';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [radius, setRadius] = useState(10);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q')?.trim() ?? '');
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(Boolean(searchParams.get('q')?.trim()));
  const [searchResults, setSearchResults] = useState<ChargingStation[]>([]);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(searchParams.get('place'));
  const [connectorFilters, setConnectorFilters] = useState<string[]>([]);
  const syncedFor = useRef<string | null>(null);
  const prefetched = useRef(new Set<string>());
  // Searching moves the active map centre to the searched area. Remember the
  // user's real location first so "Show Nearby" can return to it.
  const originalLocation = useRef<{ lat: number; lng: number } | null>(null);
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
    // Remember the user's real location as soon as one is available — not
    // after an awaited search. A slow/cancelled search or a stale GPS refetch
    // must never let the searched area become the "home" we restore.
    if (location && !originalLocation.current) originalLocation.current = location;
  }, [location]);
  // Guard so a submit that writes ?q= does not re-run the search from the URL
  // effect, while real back/forward navigation still does. Include the place
  // id so picking a different suggestion with the same label still searches.
  const appliedQuery = useRef('');
  const searchSignature = (q: string, place?: string | null) =>
    `${q.trim().toLowerCase()}::${place ?? ''}`;
  const suggestionTimer = useRef<number | null>(null);
  const suggestionRequest = useRef(0);
  // A search can still be in flight when the user hits "Show Nearby". Ignore
  // its late result so it cannot re-apply the searched area after we return.
  const searchRun = useRef(0);
  const prefetchStation = usePrefetchStation();
  const { toast } = useToast();

  const prefetchOnce = (station: ChargingStation) => {
    if (prefetched.current.has(station.id)) return;
    prefetched.current.add(station.id);
    prefetchStation(station);
  };

  const runSearch = useCallback(async (query: string, placeId?: string) => {
    const runId = ++searchRun.current;
    setIsSearching(true);
    setShowSearchResults(true);
    setShowSuggestions(false);

    try {
      const results = await queryClient.fetchQuery({
        queryKey: stationKeys.search(query, placeId),
        queryFn: () => EVStationService.searchStationsByLocation(query, placeId, (label) => {
          // Auto-correct a typed misspelling using Google's canonical place
          // name. A user-chosen place already has the correct label.
          if (!placeId && label && label.toLowerCase() !== query.toLowerCase()) {
            setSearchQuery(label);
          }
        }),
        staleTime: 10 * 60 * 1000,
      });
      if (runId !== searchRun.current) return;
      setSearchResults(results);

      // Move the nearby map centre to the searched area so distances on the
      // result cards are relative to it. Keep the user's real location stored
      // so "Show Nearby" can switch straight back to it.
      if (results.length > 0) {
        const avgLat = results.reduce((sum, station) => sum + station.lat, 0) / results.length;
        const avgLng = results.reduce((sum, station) => sum + station.lng, 0) / results.length;
        onLocationUpdate({ lat: avgLat, lng: avgLng });
      }

      toast({
        title: 'Search completed',
        description: `Found ${results.length} stations for "${query}"`,
      });
    } catch (error) {
      toast({
        title: 'Search failed',
        description: 'Could not search for stations. Please try again.',
        variant: 'destructive',
      });
    } finally {
      if (runId === searchRun.current) setIsSearching(false);
    }
  }, [queryClient, onLocationUpdate, toast]);

  // A shared link (?q=&place=) restores the exact search, including on a fresh
  // load. Back/forward navigation updates the query without a reload.
  useEffect(() => {
    const urlQuery = searchParams.get('q')?.trim() ?? '';
    const urlPlace = searchParams.get('place') ?? '';
    const signature = searchSignature(urlQuery, urlPlace);
    if (signature === appliedQuery.current) return;
    appliedQuery.current = signature;
    setSuggestions([]);
    setShowSuggestions(false);
    if (urlQuery || urlPlace) {
      setSearchQuery(urlQuery);
      setSelectedPlaceId(urlPlace || null);
      void runSearch(urlQuery, urlPlace || undefined);
    } else {
      setSearchQuery('');
      setSelectedPlaceId(null);
      setShowSearchResults(false);
      setSearchResults([]);
    }
  }, [searchParams, runSearch]);

  // Cached by location + radius, so detail→back never refetches the list.
  const nearbyQuery = useNearbyStations(location, radius);
  const nearbyStations = nearbyQuery.data ?? [];
  // Only block the list on a first load; keep cached rows visible during a
  // background refresh so detail→back feels instant.
  const isLoading = nearbyQuery.isPending;

  const stations = showSearchResults ? searchResults : nearbyStations;
  // Non-blocking: straight-line distances render immediately, road distances
  // replace them after this post-render table request finishes. Query the full
  // (unfiltered) list so toggling a connector does not re-request distances.
  const distanceQuery = useDrivingDistances(location, stations);
  const drivingDistances = distanceQuery.data;
  // The list starts sorted by straight-line distance. Once road distances
  // arrive, re-sort by the value actually shown on each card — otherwise a
  // 2.1 km row can sit above a 1.9 km row and look unsorted.
  const orderedStations = useMemo(() => {
    if (!distanceQuery.isSuccess || !drivingDistances) return stations;
    const distanceOf = (station: ChargingStation) =>
      drivingDistances[station.id] ?? station.distance ?? Number.POSITIVE_INFINITY;
    return [...stations].sort((a, b) => distanceOf(a) - distanceOf(b));
  }, [stations, drivingDistances, distanceQuery.isSuccess]);
  const visibleStations = orderedStations.filter(station =>
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

  // Google autocomplete powers a Uber-style place picker. Requests are
  // debounced and stale responses ignored so fast typing cannot reorder the
  // dropdown.
  const loadSuggestions = async (value: string) => {
    const requestId = ++suggestionRequest.current;
    setIsFetchingSuggestions(true);
    const results = await EVStationService.suggestPlaces(value);
    if (requestId !== suggestionRequest.current) return;
    setIsFetchingSuggestions(false);
    setSuggestions(results);
    setHighlightedSuggestion(0);
    setShowSuggestions(results.length > 0);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchQuery(value);
    setSelectedPlaceId(null);
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    if (value.trim().length < 2) {
      suggestionRequest.current++;
      setSuggestions([]);
      setShowSuggestions(false);
      setIsFetchingSuggestions(false);
      return;
    }
    suggestionTimer.current = window.setTimeout(() => void loadSuggestions(value), 250);
  };

  const selectSuggestion = (suggestion: PlaceSuggestion) => {
    setShowSuggestions(false);
    setSuggestions([]);
    void submitSearch(suggestion.label, suggestion.placeId);
  };

  // If the user pressed Search/Enter without choosing a row, auto-correct to
  // Google's top place prediction (this also fixes simple misspellings).
  const submitSearch = async (typedQuery: string, placeId?: string) => {
    // A debounced autocomplete request may still be in flight. Cancel it so a
    // late response cannot reopen the dropdown over the results/controls.
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    suggestionRequest.current++;
    setIsFetchingSuggestions(false);
    let finalQuery = typedQuery.trim().replace(/\s+/g, ' ');
    let finalPlaceId = placeId;
    if (!finalQuery && !finalPlaceId) {
      toast({
        title: 'Please enter a location',
        description: "Try an area and city, like 'Koramangala, Bangalore'",
        variant: 'destructive',
      });
      return;
    }

    if (!finalPlaceId && finalQuery.length >= 2) {
      const matches = suggestions.length > 0
        ? suggestions
        : await EVStationService.suggestPlaces(finalQuery);
      if (matches.length > 0) {
        finalPlaceId = matches[0].placeId;
        finalQuery = matches[0].label;
      }
    }

    setSearchQuery(finalQuery);
    setSelectedPlaceId(finalPlaceId ?? null);
    setSuggestions([]);
    setShowSuggestions(false);
    appliedQuery.current = searchSignature(finalQuery, finalPlaceId);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('q', finalQuery);
      if (finalPlaceId) next.set('place', finalPlaceId);
      else next.delete('place');
      return next;
    });
    await runSearch(finalQuery, finalPlaceId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestion(index => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestion(index => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const highlighted = showSuggestions ? suggestions[highlightedSuggestion] : undefined;
      if (highlighted) selectSuggestion(highlighted);
      else void submitSearch(event.currentTarget.value, selectedPlaceId ?? undefined);
    } else if (event.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  useEffect(() => () => {
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    suggestionRequest.current++;
  }, []);

  const handleShowNearby = () => {
    searchRun.current++;
    setIsSearching(false);
    appliedQuery.current = '';
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('q');
      next.delete('place');
      return next;
    });
    setShowSearchResults(false);
    setSearchQuery('');
    setSearchResults([]);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedPlaceId(null);

    // Return to the user's real location and make sure the nearby list is
    // refetched for it instead of reusing the searched area's cached rows.
    const home = originalLocation.current;
    if (home) {
      onLocationUpdate(home);
      // The home query is inactive while search results are shown, so use
      // refetchType 'all' to make sure it reloads rather than relying on a
      // possibly-still-fresh cache entry.
      queryClient.invalidateQueries({
        queryKey: stationKeys.nearby(home, radius),
        refetchType: 'all',
      });
    }
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
      <Card className="relative z-20 rounded-2xl">
        <CardContent className="p-3 sm:p-4">
          <div className="flex gap-2 mb-2.5">
            <div className="relative min-w-0 flex-1">
              <Input
                placeholder="Search area, city or place"
                value={searchQuery}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
                className="min-w-0 min-h-[44px]"
                aria-label="Search for charging stations by area or city"
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls="ampo-place-suggestions"
                aria-autocomplete="list"
              />
              {showSuggestions && (
                <ul
                  id="ampo-place-suggestions"
                  role="listbox"
                  aria-label="Matching places"
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
                >
                  {isFetchingSuggestions && suggestions.length === 0 ? (
                    <li role="presentation" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding places…
                    </li>
                  ) : suggestions.map((suggestion, index) => (
                    <li key={suggestion.placeId} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === highlightedSuggestion}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightedSuggestion(index)}
                        onClick={() => selectSuggestion(suggestion)}
                        className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                          index === highlightedSuggestion ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                        }`}
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{suggestion.primaryText}</span>
                          {suggestion.secondaryText && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {suggestion.secondaryText}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button
              onClick={() => void submitSearch(searchQuery, selectedPlaceId ?? undefined)}
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
          {/* Stable two-line layout on mobile: a truncated status label and
              one control row. A long search query must never reflow the
              filter controls below it. */}
          <div className="space-y-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4 shrink-0 text-primary" />
              {showSearchResults ? (
                <span className="min-w-0 truncate" title={`Search results for "${searchQuery}"`}>
                  Search results for &ldquo;{searchQuery}&rdquo;
                </span>
              ) : (
                <span className="min-w-0 truncate">Showing results near you</span>
              )}
            </div>

            {/* Distance and connector sit side by side on mobile. */}
            <div data-testid="search-controls" className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
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
                <StationCard
                  key={station.id}
                  station={station}
                  userLocation={location}
                  drivingDistanceKm={drivingDistances?.[station.id]}
                  onPrefetch={() => prefetchOnce(station)}
                />
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
