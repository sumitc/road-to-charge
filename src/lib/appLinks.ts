import type { ChargingStation } from '@/types/station';

export function directionsUrl(station: ChargingStation): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`;
}

export function mapsPlaceUrl(station: ChargingStation): string {
  return (
    station.placeDetails?.googleMapsUri ||
    station.mapsLink ||
    `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}`
  );
}

export function chargingAppUrl(station: ChargingStation): string {
  const provider = station.provider.toLowerCase();
  if (provider.includes('tata')) {
    return 'https://play.google.com/store/apps/details?id=com.tatapower.evapp';
  }
  if (provider.includes('jio') || provider.includes('bp')) {
    return 'https://play.google.com/store/apps/details?id=com.jiobp.pulse_charge';
  }
  if (provider.includes('bolt')) {
    return 'https://play.google.com/store/apps/details?id=com.revos.bolt.android';
  }
  if (provider.includes('ather')) {
    return 'https://play.google.com/store/apps/details?id=com.atherenergy.aegridapp';
  }
  if (provider.includes('charge') && provider.includes('zone')) {
    return 'https://play.google.com/store/apps/details?id=com.chargezone';
  }
  return `https://play.google.com/store/search?q=${encodeURIComponent(provider + ' EV charging app India')}`;
}
