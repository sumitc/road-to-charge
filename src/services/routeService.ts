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
  private static getSupabaseClient() {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(
      'https://hiwzxhkfkkkvglwjhnvy.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpd3p4aGtma2trdmdsd2pobnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxNjcyNDMsImV4cCI6MjA2ODc0MzI0M30.sl4DjeJDquEjTjXCcKsdO84brM-HT0M1eIMKtURg7bc'
    );
  }
  
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

      const supabase = this.getSupabaseClient();

      const { data, error } = await supabase.functions.invoke('calculate-route', {
        body: { coordinates }
      });

      if (error) {
        console.error('Route calculation error:', error);
        throw new Error(`Route calculation failed: ${error.message}`);
      }

      return data as Route;

    } catch (error) {
      console.error('Error calculating route:', error);
      return null;
    }
  }

  static async geocodeAddress(address: string): Promise<RoutePoint | null> {
    try {
      const supabase = this.getSupabaseClient();

      const { data, error } = await supabase.functions.invoke('geocode', {
        body: { address }
      });

      if (error) {
        console.error('Geocoding error:', error);
        throw new Error(`Geocoding failed: ${error.message}`);
      }

      return data as RoutePoint;

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