import { UserLocation } from '@/types/station';

export interface RoutePoint {
  lat: number;
  lng: number;
  address?: string;
}

export interface Route {
  coordinates: [number, number][]; // [lng, lat] format for Leaflet
  distance: number; // in meters
  duration: number; // in seconds
  instructions: string[];
}

export class RouteService {
  private static readonly OPENROUTE_BASE_URL = 'https://api.openrouteservice.org/v2';
  
  // Free tier API key for OpenRouteService (public, rate-limited)
  private static readonly API_KEY = '5b3ce3597851110001cf6248b20188b5c9e24a6e991ba49fdb2b3a2b';
  
  static async calculateRoute(
    start: RoutePoint,
    end: RoutePoint,
    waypoints: RoutePoint[] = []
  ): Promise<Route | null> {
    try {
      const coordinates = [
        [start.lng, start.lat],
        ...waypoints.map(wp => [wp.lng, wp.lat]),
        [end.lng, end.lat]
      ];

      const response = await fetch(`${this.OPENROUTE_BASE_URL}/directions/driving-car`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
          'Authorization': this.API_KEY,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          coordinates,
          format: 'geojson',
          instructions: true,
          geometry_simplify: true
        })
      });

      if (!response.ok) {
        throw new Error(`Route calculation failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        throw new Error('No route found');
      }

      const route = data.features[0];
      const geometry = route.geometry;
      const properties = route.properties;

      return {
        coordinates: geometry.coordinates as [number, number][],
        distance: properties.segments[0].distance,
        duration: properties.segments[0].duration,
        instructions: properties.segments[0].steps.map((step: any) => step.instruction)
      };

    } catch (error) {
      console.error('Error calculating route:', error);
      return null;
    }
  }

  static async geocodeAddress(address: string): Promise<RoutePoint | null> {
    try {
      const response = await fetch(
        `${this.OPENROUTE_BASE_URL}/geocode/search?api_key=${this.API_KEY}&text=${encodeURIComponent(address)}&size=1`
      );

      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        throw new Error('Address not found');
      }

      const feature = data.features[0];
      const [lng, lat] = feature.geometry.coordinates;

      return {
        lat,
        lng,
        address: feature.properties.label
      };

    } catch (error) {
      console.error('Error geocoding address:', error);
      return null;
    }
  }

  static calculateDistance(point1: UserLocation, point2: UserLocation): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(point2.lat - point1.lat);
    const dLng = this.toRadians(point2.lng - point1.lng);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(point1.lat)) *
      Math.cos(this.toRadians(point2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  static formatDistance(meters: number): string {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  }
}