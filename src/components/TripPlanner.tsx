import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { MapPin, Plus, X, Route as RouteIcon, Zap, Clock, Navigation } from 'lucide-react';
import { RouteService, RoutePoint, Route } from '@/services/routeService';
import { EVStationService } from '@/services/evStationService';
import { ChargingStation } from '@/types/station';
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
  const [connectorFilter, setConnectorFilter] = useState<string>('all');
  const [isPlanning, setIsPlanning] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<Route | null>(null);
  const [routeStations, setRouteStations] = useState<ChargingStation[]>([]);
  const [routeCoordinates, setRouteCoordinates] = useState<RoutePoint[]>([]);

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
      // Get all stations from the database
      const allStations = await EVStationService.getStationsWithDistance({ lat: 0, lng: 0 }, 1000);
      
      // Filter stations that are within 5km of the route
      const nearbyStations = allStations.filter(station => {
        return route.coordinates.some(([lng, lat]) => {
          const distance = RouteService.calculateDistance(
            { lat: station.lat, lng: station.lng },
            { lat, lng }
          );
          return distance <= 5; // 5km radius
        });
      });

      // Apply connector filter
      let filteredStations = nearbyStations;
      if (connectorFilter !== 'all') {
        filteredStations = nearbyStations.filter(station => 
          station.connectorTypes?.some(type => 
            type.toLowerCase().includes(connectorFilter.toLowerCase())
          )
        );
      }

      return filteredStations;
    } catch (error) {
      console.error('Error finding stations along route:', error);
      return [];
    }
  }, [connectorFilter]);

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

      setCurrentRoute(route);
      setRouteStations(stations);
      setRouteCoordinates([startPoint, ...waypoints, endPoint]);

      toast({
        title: 'Trip planned successfully',
        description: `Found ${stations.length} charging stations along your ${RouteService.formatDistance(route.distance)} route.`,
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
  }, [startLocation, endLocation, waypoints, connectorFilter, findStationsAlongRoute, toast]);

  const clearTrip = useCallback(() => {
    setCurrentRoute(null);
    setRouteStations([]);
    setRouteCoordinates([]);
  }, []);

  return (
    <div className="space-y-6">
      {/* Trip Planning Form */}
      <Card>
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
            />
          </div>

          {/* Waypoints */}
          {waypoints.length > 0 && (
            <div className="space-y-2">
              <Label>Waypoints</Label>
              <div className="space-y-2">
                {waypoints.map((waypoint) => (
                  <div key={waypoint.id} className="flex items-center space-x-2">
                    <Badge variant="outline" className="flex-1">
                      <MapPin className="w-3 h-3 mr-1" />
                      {waypoint.address}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
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
          <div className="flex space-x-2">
            <Input
              placeholder="Add waypoint (optional)"
              value={newWaypoint}
              onChange={(e) => setNewWaypoint(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addWaypoint()}
            />
            <Button variant="outline" onClick={addWaypoint}>
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
            />
          </div>

          {/* Connector Filter */}
          <div className="space-y-2">
            <Label>Connector Type Filter</Label>
            <Select value={connectorFilter} onValueChange={setConnectorFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Connectors</SelectItem>
                <SelectItem value="ccs">CCS</SelectItem>
                <SelectItem value="type2">Type 2</SelectItem>
                <SelectItem value="chademo">CHAdeMO</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-2">
            <Button onClick={planTrip} disabled={isPlanning} className="flex-1">
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
              <Button variant="outline" onClick={clearTrip}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Route Summary */}
      {currentRoute && (
        <Card>
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
        <Card>
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
      {routeStations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Zap className="w-5 h-5" />
              <span>Charging Stations Along Route</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {routeStations.map((station) => (
                <div key={station.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold">{station.name}</h3>
                    <Badge variant={station.status === 'operational' ? 'default' : 'secondary'}>
                      {station.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{station.address}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {station.powerOutput && (
                      <Badge variant="outline">{station.powerOutput}</Badge>
                    )}
                    {station.connectorTypes?.map((connector, index) => (
                      <Badge key={index} variant="outline">{connector}</Badge>
                    ))}
                    {station.pricing && (
                      <Badge variant="outline">{station.pricing}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TripPlanner;