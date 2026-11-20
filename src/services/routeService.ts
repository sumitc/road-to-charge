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
  
  static async calculateRoute(
    start: RoutePoint,
    end: RoutePoint,
    waypoints: RoutePoint[] = []
  ): Promise<Route | null> {
    try {
      const coords = [
        [start.lng, start.lat],
        ...waypoints.map(wp => [wp.lng, wp.lat]),
        [end.lng, end.lat]
      ].map(([lng, lat]) => `${lng},${lat}`).join(';');

      // `steps=true` returns turn-by-turn data we never render; dropping it
      // makes long routes dramatically smaller and faster to fetch.
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
        { signal: AbortSignal.timeout(20000) }
      );
      if (!response.ok) throw new Error(`Routing service returned ${response.status}`);
      const data = await response.json();
      const route = data.routes?.[0];
      if (!route) return null;

      return {
        coordinates: route.geometry.coordinates as [number, number][],
        distance: route.distance,
        duration: route.duration,
        instructions: [],
      };

    } catch (error) {
      console.error('Error calculating route:', error);
      return null;
    }
  }

  static async geocodeAddress(address: string): Promise<RoutePoint | null> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
      );
      if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`);
      const results = await response.json();
      const result = results?.[0];
      if (!result) return null;

      return {
        lat: Number(result.lat),
        lng: Number(result.lon),
        address: result.display_name,
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