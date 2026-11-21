import { UserLocation } from '@/types/station';

interface CachedLocation {
  location: UserLocation;
  timestamp: number;
}

const CACHE_KEY = 'ampo_last_location';
const DELHI_FALLBACK: UserLocation = { lat: 28.6139, lng: 77.2090 };

export interface ResolvedLocation {
  location: UserLocation;
  isFallback: boolean;
}

export class LocationService {
  /** Last known location, used for an instant first paint before GPS resolves. */
  static getCachedLocation(): CachedLocation | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedLocation;
      if (
        Number.isFinite(parsed?.location?.lat) &&
        Number.isFinite(parsed?.location?.lng) &&
        Number.isFinite(parsed?.timestamp)
      ) {
        return parsed;
      }
    } catch {
      // ignore malformed cache
    }
    return null;
  }

  static saveLocation(location: UserLocation): void {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ location, timestamp: Date.now() } satisfies CachedLocation),
      );
    } catch {
      // ignore storage errors
    }
  }

  /**
   * A failed/denied GPS lookup must be distinguishable from a real fix: the
   * Delhi value is only a last-resort display location, never a user location
   * that should be persisted or replace a known-good cached one.
   */
  static async getCurrentLocation(): Promise<ResolvedLocation> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ location: DELHI_FALLBACK, isFallback: true });
        return;
      }

      // City-level accuracy is enough for nearby stations and resolves much
      // faster than enableHighAccuracy on phones.
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            location: {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            },
            isFallback: false,
          });
        },
        () => {
          resolve({ location: DELHI_FALLBACK, isFallback: true });
        },
        {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 300000, // 5 minutes
        }
      );
    });
  }

  static calculateDistance(
    point1: UserLocation,
    point2: UserLocation
  ): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(point2.lat - point1.lat);
    const dLng = this.toRadians(point2.lng - point1.lng);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(point1.lat)) *
        Math.cos(this.toRadians(point2.lat)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10; // Round to 1 decimal place
  }

  private static toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
  }
}
