import { UserLocation } from '@/types/station';

export class LocationService {
  static async getCurrentLocation(): Promise<UserLocation> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        // Fallback to IP-based location (mock for now)
        resolve({ lat: 28.6139, lng: 77.2090 }); // Delhi
        return;
      }

      // Try GPS first
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.warn('GPS location failed:', error);
          // Fallback to IP-based location (mock for now)
          resolve({ lat: 28.6139, lng: 77.2090 }); // Delhi
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
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
    return degrees * (Math.PI / 180);
  }
}