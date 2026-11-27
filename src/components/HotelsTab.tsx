import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { BatteryCharging, ExternalLink, Loader2, MapPin, RotateCcw, Search, Star } from 'lucide-react';
import affiliateLinks from '@/data/affiliateLinks.json';
import { hasAuthenticOnSiteEvidence, hotelIndex as index, type Hotel } from '@/lib/hotelIndex';
import { hotelPhotoUrl } from '@/lib/hotelPhotos';
import { ConnectorFilter } from '@/components/ConnectorFilter';
import { matchesConnectorFilters } from '@/lib/connectorLabels';
import { matchesPlaceQuery } from '@/lib/placeAliases';
import { cn } from '@/lib/utils';
import { trackAmpo } from '@/lib/analytics';
import { trackEmptyResult } from '@/lib/emptyResults';
import { EVStationService, type PlaceSuggestion, type ResolvedPlaceAnchor } from '@/services/evStationService';
import { useUserLocation } from '@/hooks/useStationQueries';
import { useDrivingDistances, type DistancePoint } from '@/hooks/useDrivingDistances';
import { RouteService } from '@/services/routeService';

const AFFILIATE_LINKS = affiliateLinks as Record<string, string>;
const hasAffiliateLinks = Object.keys(AFFILIATE_LINKS).some(key => !key.startsWith('_'));

const MAX_HOTEL_RADIUS_KM = 25;
const RADIUS_OPTIONS = [
  { value: '5', label: '5 km' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
];

type PlaceAnchor = Omit<ResolvedPlaceAnchor, 'placeId'> & {
  source: 'indexed' | 'google';
};

function formatMetres(metres?: number | null) {
  if (!Number.isFinite(metres as number)) return '';
  return metres! < 1000 ? `${Math.round(metres!)} m` : `${(metres! / 1000).toFixed(1)} km`;
}

function formatKm(km?: number | null) {
  if (!Number.isFinite(km as number)) return '';
  return km! < 1 ? `${Math.round(km! * 1000)} m` : `${km!.toFixed(1)} km`;
}

/** Small search-results-style pill; proximity never upgrades to on-site. */
function evEvidenceTag(hotel: Hotel) {
  const onSite = hasAuthenticOnSiteEvidence(hotel);
  return {
    label: onSite ? 'EV on site' : 'Charger nearby',
    tone: onSite
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-blue-200 bg-blue-50 text-blue-700',
    dot: onSite ? 'bg-emerald-500' : 'bg-blue-500',
  };
}

/** Cheap gate so city/area searches never trigger a paid lodging text search. */
function matchesIndexedHotelPlace(term: string) {
  const needle = term.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!needle) return false;
  return index.areas.some(area => area.coordinates && matchesPlaceQuery(
    [area.name, area.city, area.state].filter(Boolean).join(' '), needle,
  )) || index.hotels.some(hotel => matchesPlaceQuery(
    [hotel.name, hotel.area, hotel.city, hotel.state, hotel.locality]
      .filter(Boolean).join(' '), needle,
  ));
}

type HotelCardProps = {
  hotel: Hotel;
  distanceKm?: number;
  distanceKind?: 'driving' | 'straight';
};

function HotelCard({ hotel, distanceKm, distanceKind }: HotelCardProps) {
  const affiliateUrl = AFFILIATE_LINKS[hotel.id] || '';
  const bookingUrl = affiliateUrl || hotel.sourceUrl;
  const nearest = hotel.ev.nearestCharger;
  const evidence = evEvidenceTag(hotel);
  const location = [hotel.locality, hotel.city, hotel.state].filter(Boolean).join(', ');
  const distanceLabel = distanceKind === 'driving' ? 'Driving distance' : 'Straight-line distance';

  return (
    <Card
      data-hotel-card={hotel.id}
      className="relative animate-fade-in overflow-hidden rounded-2xl border-border/70 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-electric"
    >
      {/* Whole-card target; real external links are lifted above it below. */}
      <Link
        to={`/hotels/${hotel.id}`}
        aria-label={`View details for ${hotel.name}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      />
      <CardContent className="pointer-events-none relative z-10 p-2.5 sm:p-3">
        <div className="flex gap-3">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-primary/10 sm:h-28 sm:w-32">
            <img
              src={hotelPhotoUrl(hotel, 320)}
              alt={hotel.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="min-w-0 text-sm font-semibold leading-tight">{hotel.name}</h3>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{location || hotel.area}</span>
              {Number.isFinite(distanceKm) && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium" title={distanceLabel}>
                  {distanceKind === 'driving' ? '~' : ''}{formatKm(distanceKm)}
                </span>
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                evidence.tone,
              )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', evidence.dot)} />
                {evidence.label}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <BatteryCharging className="h-3 w-3 shrink-0" />
                {hotel.ev.label}
              </span>
            </div>
            {nearest && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                Nearest: {nearest.provider} · {nearest.name} · {formatMetres(nearest.distanceMeters)}
              </p>
            )}
            {hotel.rating != null && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {hotel.rating}
              </p>
            )}
          </div>
        </div>
        {hasAuthenticOnSiteEvidence(hotel) && (
          <p className="mt-2 rounded-lg bg-muted/60 p-2 text-[11px] leading-snug text-muted-foreground">
            {hotel.onSiteEvidenceSource?.label}: &ldquo;{hotel.onSiteEvidenceSource?.quote}&rdquo;{' '}
            <a
              href={hotel.onSiteEvidenceSource?.url}
              target="_blank"
              rel="noopener noreferrer"
              className="pointer-events-auto underline underline-offset-2"
            >
              Source <ExternalLink className="inline h-2.5 w-2.5" />
            </a>
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            Source: {hotel.source}
            {hotel.tripadvisorUrl && (
              <> · <a href={hotel.tripadvisorUrl} target="_blank" rel="noopener noreferrer" className="pointer-events-auto underline underline-offset-2">Tripadvisor</a></>
            )}
            {hotel.photo?.sourceUrl && (
              <> · Photo: <a href={hotel.photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="pointer-events-auto underline underline-offset-2">Google Maps</a></>
            )}
          </span>
          <Button variant="ghost" size="sm" asChild className="pointer-events-auto h-7 shrink-0 px-2 text-[11px]">
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
              {affiliateUrl ? 'Book via partner' : 'View on Google Maps'} <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function HotelsTab() {
  const [query, setQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [connectors, setConnectors] = useState<string[]>([]);
  // The hotel list is intentionally bounded: 25 km is both the default and
  // the maximum, so browsing never opens with hundreds of distant stays.
  const [radiusKm, setRadiusKm] = useState<number | null>(MAX_HOTEL_RADIUS_KM);
  // A picked Google place can be outside the 32 curated areas. Resolve its
  // real coordinates once; never fall back to the device for a place search.
  const [resolvedAnchor, setResolvedAnchor] = useState<PlaceAnchor | null>(null);
  // A stay found through Google autocomplete but missing from the curated seed
  // is verified live, then shown alongside the index for this and later visits.
  const [discoveredHotel, setDiscoveredHotel] = useState<Hotel | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const suggestionTimer = useRef<number | null>(null);
  const suggestionRequest = useRef(0);
  const resolveRequest = useRef(0);
  const discoveryRequest = useRef(0);
  const loggedEmpty = useRef<string | null>(null);

  const { data: userLocation } = useUserLocation();

  // The generated index already carries Google place IDs and coordinates for
  // every curated area and hotel, so exact picks need no extra lookup.
  const areaByPlaceId = useMemo(() => new Map(
    index.areas
      .filter(area => area.placeId && area.coordinates)
      .map(area => [area.placeId!, {
        ...area.coordinates!, label: area.name, source: 'indexed' as const,
      }] as const),
  ), []);
  const hotelByPlaceId = useMemo(() => new Map(
    index.hotels.map(hotel => [hotel.provenance.placeId, {
      lat: hotel.location.lat,
      lng: hotel.location.lng,
      id: hotel.id,
      label: hotel.name,
      source: 'indexed' as const,
    }] as const),
  ), []);

  const searchNeedle = useMemo(
    () => (selectedPlace?.primaryText || query).trim().replace(/\s+/g, ' ').toLowerCase(),
    [query, selectedPlace],
  );

  // A typed or picked place name can still match a curated area even when
  // Google returns a different Place ID (e.g. "Goa, India" vs "Goa (Panaji)").
  const textAnchor = useMemo<PlaceAnchor | null>(() => {
    if (!searchNeedle) return null;
    const area = index.areas.find(candidate => candidate.coordinates
      && matchesPlaceQuery(
        [candidate.name, candidate.city, candidate.state].filter(Boolean).join(' '),
        searchNeedle,
      ));
    if (area?.coordinates) {
      return { ...area.coordinates, label: area.name, source: 'indexed' };
    }
    const hotel = index.hotels.find(candidate => matchesPlaceQuery(
      [candidate.name, candidate.area, candidate.city, candidate.state, candidate.locality]
        .filter(Boolean).join(' '),
      searchNeedle,
    ));
    if (hotel) {
      return { ...hotel.location, label: hotel.name, source: 'indexed' };
    }
    return null;
  }, [searchNeedle]);

  const staticAnchor = selectedPlace
    ? (areaByPlaceId.get(selectedPlace.placeId) ?? hotelByPlaceId.get(selectedPlace.placeId) ?? null)
    : null;
  const anchor = resolvedAnchor ?? staticAnchor ?? textAnchor ?? null;
  const origin = anchor ?? userLocation ?? null;
  const originLabel = anchor?.label ?? 'your location';
  const focusedHotelId = selectedPlace
    ? (hotelByPlaceId.get(selectedPlace.placeId)?.id ?? discoveredHotel?.id)
    : undefined;

  const visibleHotels = useMemo(
    () => (discoveredHotel ? [...index.hotels, discoveredHotel] : index.hotels),
    [discoveredHotel],
  );

  const straightKmByHotel = useMemo(() => {
    const result: Record<string, number> = {};
    if (!origin) return result;
    visibleHotels.forEach(hotel => {
      result[hotel.id] = RouteService.calculateDistance(origin, hotel.location);
    });
    return result;
  }, [origin, visibleHotels]);

  const allHotelPoints = useMemo<DistancePoint[]>(
    () => visibleHotels.map(hotel => ({ id: hotel.id, lat: hotel.location.lat, lng: hotel.location.lng })),
    [visibleHotels],
  );
  const drivingDistances = useDrivingDistances(origin, allHotelPoints, 'hotels');

  const distanceFor = useCallback((hotel: Hotel): { km?: number; kind: 'driving' | 'straight' } => {
    const road = drivingDistances.data?.[hotel.id];
    if (typeof road === 'number' && Number.isFinite(road)) return { km: road, kind: 'driving' };
    const straight = straightKmByHotel[hotel.id];
    return Number.isFinite(straight) ? { km: straight, kind: 'straight' } : { kind: 'straight' };
  }, [drivingDistances.data, straightKmByHotel]);

  const filtered = useMemo(() => {
    const rows = visibleHotels.filter(hotel => {
      if (focusedHotelId && hotel.id !== focusedHotelId) return false;
      if (searchNeedle) {
        // Hotel-only search: name, locality, city, state or address. Never the
        // internal EV taxonomy or charger text. Aliases let "bangalore" find
        // rows indexed as "Bengaluru".
        const haystack = [
          hotel.name, hotel.area, hotel.city, hotel.state, hotel.locality, hotel.formattedAddress,
        ].filter(Boolean).join(' ');
        if (!matchesPlaceQuery(haystack, searchNeedle)) return false;
      }
      if (!matchesConnectorFilters(hotel.ev.connectorTypes, connectors)) return false;
      if (radiusKm !== null) {
        const distance = distanceFor(hotel).km;
        if (!Number.isFinite(distance) || distance! > radiusKm) return false;
      }
      return true;
    });

    return rows.sort((left, right) => {
      const leftDistance = distanceFor(left).km;
      const rightDistance = distanceFor(right).km;
      if (Number.isFinite(leftDistance) && Number.isFinite(rightDistance) && leftDistance !== rightDistance) {
        return leftDistance! - rightDistance!;
      }
      return (right.rating ?? 0) - (left.rating ?? 0);
    });
  }, [connectors, distanceFor, focusedHotelId, radiusKm, searchNeedle, visibleHotels]);

  // Count each distinct failed query/filter combination once, not on every
  // render. Clearing back to a non-empty list re-arms the same query.
  useEffect(() => {
    const signature = [
      query.trim().toLowerCase(),
      connectors.join(','),
      radiusKm ?? 'all',
    ].join('::');
    if (filtered.length > 0 || isDiscovering) {
      loggedEmpty.current = null;
      return;
    }
    if (loggedEmpty.current === signature) return;
    loggedEmpty.current = signature;
    const filters = [
      connectors.length ? `connectors=${connectors.join(',')}` : '',
      radiusKm !== null && radiusKm !== MAX_HOTEL_RADIUS_KM ? `radius=${radiusKm}` : '',
    ].filter(Boolean).join(',');
    trackEmptyResult({
      surface: 'hotels',
      query: query.trim() || null,
      placeId: selectedPlace?.placeId ?? null,
      radiusKm: radiusKm ?? undefined,
      filter: filters || undefined,
      reason: filters ? 'filters' : 'no_rows',
    });
  }, [connectors, filtered.length, isDiscovering, query, radiusKm, selectedPlace]);

  useEffect(() => () => {
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    suggestionRequest.current++;
    resolveRequest.current++;
    discoveryRequest.current++;
  }, []);

  const loadSuggestions = useCallback(async (term: string) => {
    const clean = term.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsFetchingSuggestions(false);
      return;
    }
    const request = ++suggestionRequest.current;
    setIsFetchingSuggestions(true);
    const results = await EVStationService.suggestPlaces(clean);
    if (request !== suggestionRequest.current) return;
    setSuggestions(results);
    setHighlightedSuggestion(results.length ? 0 : -1);
    setShowSuggestions(results.length > 0);
    setIsFetchingSuggestions(false);
  }, []);

  const runDiscovery = useCallback(async ({ placeId, query }: { placeId?: string; query?: string }) => {
    const request = ++discoveryRequest.current;
    setDiscoveredHotel(null);
    setIsDiscovering(true);
    const hotel = await EVStationService.discoverHotel({ placeId, query });
    if (request !== discoveryRequest.current) return;
    setDiscoveredHotel(hotel);
    setIsDiscovering(false);
    if (hotel) {
      setResolvedAnchor({
        lat: hotel.location.lat,
        lng: hotel.location.lng,
        label: hotel.name,
        source: 'google',
      });
    }
  }, []);

  const clearDiscovery = useCallback(() => {
    discoveryRequest.current++;
    setDiscoveredHotel(null);
    setIsDiscovering(false);
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedPlace(null);
    setResolvedAnchor(null);
    clearDiscovery();
    resolveRequest.current++;
    setHighlightedSuggestion(-1);
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    const clean = value.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      suggestionRequest.current++;
      setSuggestions([]);
      setShowSuggestions(false);
      setIsFetchingSuggestions(false);
      return;
    }
    suggestionTimer.current = window.setTimeout(() => void loadSuggestions(clean), 250);
  };

  const selectSuggestion = (suggestion: PlaceSuggestion) => {
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    suggestionRequest.current++;
    const request = ++resolveRequest.current;
    setQuery(suggestion.label);
    setSelectedPlace(suggestion);
    setResolvedAnchor(null);
    clearDiscovery();
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedSuggestion(-1);
    setIsFetchingSuggestions(false);
    trackAmpo('place_selected', {
      place_id: suggestion.placeId,
      label: suggestion.label.slice(0, 120),
      source: 'hotels',
    });

    // Exact curated IDs already have authoritative coordinates. Any other
    // Google pick is resolved so the distance origin follows the searched
    // place instead of the user's GPS.
    if (areaByPlaceId.has(suggestion.placeId) || hotelByPlaceId.has(suggestion.placeId)) return;
    // The exact Google pick is the strongest signal — verify it as a stay and
    // only keep it when Places reports real EV data.
    void runDiscovery({ placeId: suggestion.placeId });
    void EVStationService.resolvePlace(suggestion.placeId).then(place => {
      if (request !== resolveRequest.current || !place) return;
      setResolvedAnchor({
        lat: place.lat,
        lng: place.lng,
        label: place.label,
        source: 'google',
      });
    });
  };

  const submitSearch = () => {
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    suggestionRequest.current++;
    const clean = query.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setSelectedPlace(null);
      setResolvedAnchor(null);
      clearDiscovery();
      resolveRequest.current++;
      setShowSuggestions(false);
      return;
    }
    const chosen = selectedPlace
      ?? (showSuggestions && suggestions.length > 0 && highlightedSuggestion >= 0
        ? suggestions[highlightedSuggestion]
        : suggestions[0]);
    if (chosen) {
      selectSuggestion(chosen);
      return;
    }
    setQuery(clean);
    setSelectedPlace(null);
    setResolvedAnchor(null);
    clearDiscovery();
    resolveRequest.current++;
    setShowSuggestions(false);
    trackAmpo('search_submit', { query: clean, place_id: null, source: 'hotels' });
    // Typed property names with no autocomplete pick still grow the index,
    // but known cities/areas stay local and never cost a Places lookup.
    if (clean.length >= 3 && !matchesIndexedHotelPlace(clean)) {
      void runDiscovery({ query: clean });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault();
      setShowSuggestions(true);
      setHighlightedSuggestion(previous => {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        return (previous + step + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (showSuggestions && suggestions.length > 0 && highlightedSuggestion >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[highlightedSuggestion]);
      }
      return;
    }
    if (event.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightedSuggestion(-1);
    }
  };

  const hasFilters = Boolean(query.trim()) || connectors.length > 0 || radiusKm !== MAX_HOTEL_RADIUS_KM;
  const showSearchResults = Boolean(query.trim()) || Boolean(selectedPlace);
  const reset = () => {
    if (suggestionTimer.current) window.clearTimeout(suggestionTimer.current);
    suggestionRequest.current++;
    resolveRequest.current++;
    setQuery('');
    setSelectedPlace(null);
    setResolvedAnchor(null);
    clearDiscovery();
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedSuggestion(-1);
    setIsFetchingSuggestions(false);
    setConnectors([]);
    setRadiusKm(MAX_HOTEL_RADIUS_KM);
  };

  const updated = useMemo(() => {
    const date = new Date(index.generatedAt);
    return Number.isNaN(date.getTime()) ? index.generatedAt : date.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }, []);

  return (
    <div className="space-y-3" aria-label="Hotels with EV charging">
      <Card className="relative z-20 rounded-2xl">
        <CardContent className="p-3 sm:p-4">
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); submitSearch(); }}>
            <div className="relative min-w-0 flex-1">
              <Input
                value={query}
                onChange={event => handleInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Hotels with EV charging"
                className="min-w-0 min-h-[44px]"
                aria-label="Search hotels by city or hotel name"
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls="ampo-hotel-place-suggestions"
                aria-autocomplete="list"
              />
              {showSuggestions && (
                <ul
                  id="ampo-hotel-place-suggestions"
                  role="listbox"
                  aria-label="Matching hotel areas and places"
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
                        onMouseDown={event => event.preventDefault()}
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
              type="submit"
              aria-label="Search"
              className="shrink-0 min-h-[44px] px-3 bg-gradient-primary hover:opacity-90"
            >
              <Search className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-2.5 space-y-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <span className="min-w-0 truncate" title={showSearchResults ? `Hotel results for "${query}"` : undefined}>
                {showSearchResults ? `Hotel results for “${query}”` : 'Hotels with chargers nearby'}
              </span>
              {hasFilters && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={reset}
                  aria-label="Show all hotels"
                  className="h-8 shrink-0 px-1 text-xs text-muted-foreground"
                >
                  All hotels
                </Button>
              )}
            </div>

            {/* Same shape as station search: radius only while browsing nearby,
                connector filter in both modes, no extra rating dropdown. */}
            <div data-testid="hotel-search-controls" className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
              {showSearchResults ? (
                <ConnectorFilter
                  selected={connectors}
                  onChange={setConnectors}
                  className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                />
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                    <MapPin className="w-4 h-4 shrink-0 text-primary" />
                    <select
                      aria-label="Search radius in kilometres"
                      value={String(radiusKm ?? MAX_HOTEL_RADIUS_KM)}
                      onChange={event => setRadiusKm(Number(event.target.value))}
                      className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm sm:w-28 sm:flex-none"
                    >
                      {RADIUS_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <ConnectorFilter
                    selected={connectors}
                    onChange={setConnectors}
                    className="min-w-0 flex-1 sm:w-56 sm:flex-none"
                  />
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isDiscovering
            ? 'Checking Google Maps for this stay…'
            : `Stays within ${radiusKm ?? MAX_HOTEL_RADIUS_KM} km of ${originLabel}`}
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={reset} className="h-8 shrink-0 px-2 text-xs">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {filtered.length ? (
        <div className="space-y-2.5">
          {filtered.map(hotel => {
            const distance = distanceFor(hotel);
            return (
              <HotelCard
                key={hotel.id}
                hotel={hotel}
                distanceKm={distance.km}
                distanceKind={distance.kind}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-6 text-center">
          {isDiscovering ? (
            <>
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
              <p className="mt-2 text-sm font-medium">Checking Google Maps for this stay…</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                We only add the property when its exact place has a real public charger nearby.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                No stays found {query.trim() ? `for “${query.trim()}”` : 'for these filters'}.
              </p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                Try a city like Jaipur or a hotel name. We only list stays with a real public charger mapped nearby.
              </p>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={reset} className="mt-3">
                  Clear search and filters
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {hasAffiliateLinks && (
        <p className="px-1 text-[10px] leading-snug text-muted-foreground">
          Some booking links are affiliate links. We may earn a commission at no extra cost to you.
        </p>
      )}
      <p className="px-1 pb-2 text-[10px] leading-snug text-muted-foreground">
        Google Places index updated {updated}. Distances are from {originLabel} to the hotel; the nearest-charger line is hotel-to-charger. Connector types come from Google Places, OSM and the Ampo catalogue where available; stays without connector data are left out when a connector is selected. Public chargers within {(index.method.radiusMeters / 1000).toFixed(1)} km are not on-site claims — open a hotel page for sources or to contribute a missing charger.
      </p>
    </div>
  );
}
