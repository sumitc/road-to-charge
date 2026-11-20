import React, { lazy, Suspense, useState, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { MapPin, Plus, X, Route as RouteIcon, Zap, Clock, Navigation } from 'lucide-react';
import { RouteService, RoutePoint, Route } from '@/services/routeService';
import { EVStationService } from '@/services/evStationService';
import { ChargingStation } from '@/types/station';
import { matchesConnectorFilters } from '@/lib/connectorLabels';
import { ConnectorFilter } from './ConnectorFilter';
import { StationCard } from './StationCard';
import { usePrefetchStation } from '@/hooks/useStationQueries';
import { useDrivingDistances } from '@/hooks/useDrivingDistances';

// Leaflet and its CSS are only needed once a route exists. Keeping the map in
// its own chunk makes the Trips tab form render as soon as possible.
const TripMap = lazy(() => import('./TripMap'));

interface Waypoint extends RoutePoint {
  id: string;
}

const TripPlanner = () => {
  const { toast } = useToast();
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [newWaypoint, setNewWaypoint] = useState('');
  const [connectorFilters, setConnectorFilters] = useState<string[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<Route | null>(null);
  const [allRouteStations, setAllRouteStations] = useState<ChargingStation[]>([]);
  const [routeCoordinates, setRouteCoordinates] = useState<RoutePoint[]>([]);
  const prefetched = useRef(new Set<string>());
  const prefetchStation = usePrefetchStation();

  const prefetchOnce = useCallback((station: ChargingStation) => {
    if (prefetched.current.has(station.id)) return;
    prefetched.current.add(station.id);
    prefetchStation(station);
  }, [prefetchStation]);

  // Derived so changing connector selections updates both the list and map
  // without having to plan the trip again.
  const routeStations = useMemo(
    () => allRouteStations.filter(station =>
      matchesConnectorFilters(station.connectorTypes, connectorFilters)
    ),
    [allRouteStations, connectorFilters]
  );
  const { data: drivingDistances } = useDrivingDistances(routeCoordinates[0] ?? null, routeStations);

  const addWaypoint = useCallback(async () => {
    if (!newWaypoint.trim()) return;

    try {
      const geocoded = await RouteService.geocodeAddress(newWaypoint);
      if (geocoded) {
        const waypoint: Waypoint = {
          ...geocoded,
          id: Date.now().toString()
        };
        setWaypoints(prev => [...prev, waypoint]);
        setNewWaypoint('');
        toast({
          title: 'Waypoint added',
          description: `Added: ${geocoded.address}`,
        });
      } else {
        toast({
          title: 'Location not found',
          description: 'Could not find the specified waypoint location.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to add waypoint.',
        variant: 'destructive',
      });
    }
  }, [newWaypoint, toast]);

  const removeWaypoint = useCallback((id: string) => {
    setWaypoints(prev => prev.filter(wp => wp.id !== id));
  }, []);

  const findStationsAlongRoute = useCallback(async (route: Route) => {
    try {
      // Iterative bounds — spreading thousands of coordinates into Math.min
      // can blow the call stack on long routes.
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const [lng, lat] of route.coordinates) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }

      const padKm = 20; // corridor half-width
      const padLat = padKm / 111.0;
      const midLat = (minLat + maxLat) / 2;
      const padLng = padKm / (111.0 * Math.cos(midLat * Math.PI / 180));

      const candidates = await EVStationService.getStationsInBounds(
        minLat - padLat,
        maxLat + padLat,
        minLng - padLng,
        maxLng + padLng
      );

      // Spatial grid: with the full 29k-station catalog, comparing every
      // candidate against every route point is O(n*m) and freezes the UI.
      // Bucket sampled route points into ~11km cells and only do exact
      // haversine checks for cells adjacent to a station.
      const CELL = 0.1;
      const step = Math.max(1, Math.floor(route.coordinates.length / 400));
      const grid = new Map<string, Array<[number, number]>>();
      for (let i = 0; i < route.coordinates.length; i += step) {
        const [lng, lat] = route.coordinates[i];
        const key = `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push([lat, lng]);
        else grid.set(key, [[lat, lng]]);
      }

      return candidates.filter(station => {
        const cellLat = Math.floor(station.lat / CELL);
        const cellLng = Math.floor(station.lng / CELL);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const bucket = grid.get(`${cellLat + dy}:${cellLng + dx}`);
            if (!bucket) continue;
            for (const [lat, lng] of bucket) {
              if (RouteService.calculateDistance(
                { lat: station.lat, lng: station.lng },
                { lat, lng }
              ) <= 5) return true;
            }
          }
        }
        return false;
      });
    } catch (error) {
      console.error('Error finding stations along route:', error);
      return [];
    }
  }, []);

  const planTrip = useCallback(async () => {
    if (!startLocation.trim() || !endLocation.trim()) {
      toast({
        title: 'Missing locations',
        description: 'Please enter both start and end locations.',
        variant: 'destructive',
      });
      return;
    }

    setIsPlanning(true);
    
    try {
      // Geocode start and end locations
      const [startPoint, endPoint] = await Promise.all([
        RouteService.geocodeAddress(startLocation),
        RouteService.geocodeAddress(endLocation)
      ]);

      if (!startPoint || !endPoint) {
        toast({
          title: 'Location not found',
          description: 'Could not find one or more locations.',
          variant: 'destructive',
        });
        return;
      }

      // Calculate route
      const route = await RouteService.calculateRoute(startPoint, endPoint, waypoints);
      
      if (!route) {
        toast({
          title: 'Route not found',
          description: 'Could not calculate a route for the given locations.',
          variant: 'destructive',
        });
        return;
      }

      // Find charging stations along the route
      const stations = await findStationsAlongRoute(route);
      const visibleCount = stations.filter(station =>
        matchesConnectorFilters(station.connectorTypes, connectorFilters)
      ).length;

      setCurrentRoute(route);
      setAllRouteStations(stations);
      setRouteCoordinates([startPoint, ...waypoints, endPoint]);

      toast({
        title: 'Trip planned successfully',
        description: `Found ${visibleCount} charging stations along your ${RouteService.formatDistance(route.distance)} route.`,
      });

    } catch (error) {
      console.error('Error planning trip:', error);
      toast({
        title: 'Planning failed',
        description: 'An error occurred while planning your trip.',
        variant: 'destructive',
      });
    } finally {
      setIsPlanning(false);
    }
  }, [startLocation, endLocation, waypoints, connectorFilters, findStationsAlongRoute, toast]);

  const clearTrip = useCallback(() => {
    setCurrentRoute(null);
    setAllRouteStations([]);
    setRouteCoordinates([]);
  }, []);

  return (
    <div className="space-y-6">
      {/* Trip Planning Form */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <RouteIcon className="w-5 h-5" />
            <span>Plan Your EV Trip</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Start Location */}
          <div className="space-y-2">
            <Label htmlFor="start-location">Start Location</Label>
            <Input
              id="start-location"
              placeholder="Enter starting address or city"
              value={startLocation}
              onChange={(e) => setStartLocation(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          {/* Waypoints */}
          {waypoints.length > 0 && (
            <div className="space-y-2">
              <Label>Waypoints</Label>
              <div className="space-y-2">
                {waypoints.map((waypoint) => (
                  <div key={waypoint.id} className="flex items-center gap-2">
                    <Badge variant="outline" className="min-w-0 flex-1 truncate">
                      <MapPin className="w-3 h-3 mr-1 shrink-0" />
                      <span className="truncate">{waypoint.address}</span>
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove waypoint"
                      className="min-h-[44px] shrink-0"
                      onClick={() => removeWaypoint(waypoint.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Waypoint */}
          <div className="flex gap-2">
            <Input
              placeholder="Add waypoint (optional)"
              value={newWaypoint}
              onChange={(e) => setNewWaypoint(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addWaypoint()}
              className="min-w-0 flex-1 min-h-[44px]"
              aria-label="Add a waypoint"
            />
            <Button
              variant="outline"
              onClick={addWaypoint}
              aria-label="Add waypoint"
              className="min-h-[44px] shrink-0 px-3"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* End Location */}
          <div className="space-y-2">
            <Label htmlFor="end-location">Destination</Label>
            <Input
              id="end-location"
              placeholder="Enter destination address or city"
              value={endLocation}
              onChange={(e) => setEndLocation(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          {/* Connector Filter */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label>Connector / charging speed</Label>
              <p className="text-xs text-muted-foreground">
                Pick as many as you like. Slow = AC, Fast/Super-fast = DC.
              </p>
            </div>
            <ConnectorFilter
              selected={connectorFilters}
              onChange={setConnectorFilters}
              className="w-full sm:w-64"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={planTrip} disabled={isPlanning} className="min-h-[44px] flex-1">
              {isPlanning ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Planning...
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4 mr-2" />
                  Plan Trip
                </>
              )}
            </Button>
            {currentRoute && (
              <Button variant="outline" onClick={clearTrip} className="min-h-[44px]">
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Route Summary — compact on mobile so the list starts higher up. */}
      {currentRoute && (
        <Card className="rounded-2xl">
          <CardContent className="p-3 sm:p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <div className="text-center">
                <div className="font-semibold text-base sm:text-lg">
                  {RouteService.formatDistance(currentRoute.distance)}
                </div>
                <div className="text-xs text-muted-foreground sm:text-sm">Distance</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-base sm:text-lg">
                  {RouteService.formatDuration(currentRoute.duration)}
                </div>
                <div className="text-xs text-muted-foreground sm:text-sm">Duration</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center font-semibold text-base sm:text-lg">
                  <Zap className="mr-1 h-4 w-4" />
                  {routeStations.length}
                </div>
                <div className="text-xs text-muted-foreground sm:text-sm">Charging Stations</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center font-semibold text-base sm:text-lg">
                  <MapPin className="mr-1 h-4 w-4" />
                  {waypoints.length + 2}
                </div>
                <div className="text-xs text-muted-foreground sm:text-sm">Total Stops</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Map */}
      {currentRoute && (
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center bg-muted/40 text-sm text-muted-foreground">
                  Loading route map…
                </div>
              }
            >
              <TripMap
                route={currentRoute}
                stations={routeStations}
                routePoints={routeCoordinates}
              />
            </Suspense>
          </CardContent>
        </Card>
      )}

      {/* Stations list — no wrapping Card/border on mobile, matching the
          nearby/search list so cards get the full width and less chrome. */}
      {allRouteStations.length > 0 && (
        <div className="space-y-3">
          <p className="hidden text-sm text-muted-foreground sm:block">
            {routeStations.length} charging station{routeStations.length !== 1 ? 's' : ''} along your route
          </p>
          {routeStations.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No stations match your connector selection
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setConnectorFilters([])}
                >
                  Show all connectors
                </Button>
              </CardContent>
            </Card>
          ) : (
            routeStations.map(station => (
              <StationCard
                key={station.id}
                station={station}
                userLocation={routeCoordinates[0]}
                drivingDistanceKm={drivingDistances?.[station.id]}
                onPrefetch={() => prefetchOnce(station)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default TripPlanner;