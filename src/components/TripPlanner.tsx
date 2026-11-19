import React, { useState, useCallback, useMemo } from 'react';
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
import TripMap from './TripMap';

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

  // Derived so changing connector selections updates both the list and map
  // without having to plan the trip again.
  const routeStations = useMemo(
    () => allRouteStations.filter(station =>
      matchesConnectorFilters(station.connectorTypes, connectorFilters)
    ),
    [allRouteStations, connectorFilters]
  );

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
      // Compute route bounding box with padding
      const lats = route.coordinates.map(([lng, lat]) => lat);
      const lngs = route.coordinates.map(([lng, lat]) => lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

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
      
      // Keep stations within 5km of any route point
      const nearbyStations = candidates.filter(station => {
        return route.coordinates.some(([lng, lat]) => {
          const distance = RouteService.calculateDistance(
            { lat: station.lat, lng: station.lng },
            { lat, lng }
          );
          return distance <= 5; // 5km radius
        });
      });

      return nearbyStations;
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

      {/* Route Summary */}
      {currentRoute && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <RouteIcon className="w-5 h-5" />
              <span>Route Summary</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="font-semibold text-lg">
                  {RouteService.formatDistance(currentRoute.distance)}
                </div>
                <div className="text-sm text-muted-foreground">Distance</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-lg">
                  {RouteService.formatDuration(currentRoute.duration)}
                </div>
                <div className="text-sm text-muted-foreground">Duration</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-lg flex items-center justify-center">
                  <Zap className="w-4 h-4 mr-1" />
                  {routeStations.length}
                </div>
                <div className="text-sm text-muted-foreground">Charging Stations</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-lg flex items-center justify-center">
                  <MapPin className="w-4 h-4 mr-1" />
                  {waypoints.length + 2}
                </div>
                <div className="text-sm text-muted-foreground">Total Stops</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Map */}
      {currentRoute && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Route Map</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TripMap
              route={currentRoute}
              stations={routeStations}
              routePoints={routeCoordinates}
            />
          </CardContent>
        </Card>
      )}

      {/* Stations List */}
      {allRouteStations.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Zap className="w-5 h-5" />
              <span>Charging Stations Along Route</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {routeStations.length === 0 ? (
              <div className="space-y-3 text-center">
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
              </div>
            ) : (
            <div className="space-y-3">
              {routeStations.map(station => (
                <StationCard key={station.id} station={station} />
              ))}
            </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TripPlanner;