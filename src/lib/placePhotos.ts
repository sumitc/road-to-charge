import type { PlaceDetails } from '@/types/station';

/** URL for a Google Places photo through the server-side proxy. */
export function placePhotoUrl(ref: string, width = 640): string {
  return `/api/place-photo?ref=${encodeURIComponent(ref)}&width=${width}`;
}

const KIND_LABELS: Record<string, string> = {
  ev_charging_station: 'charging site',
  gas_station: 'petrol station',
  convenience_store: 'store',
  car_repair: 'service station',
  restaurant: 'restaurant',
  cafe: 'cafe',
};

/** Short, honest label for a photo borrowed from a nearby landmark. */
export function photoSourceLabel(source?: PlaceDetails['photoSource']): string | null {
  if (!source) return null;
  const kind = KIND_LABELS[source.kind] ?? 'landmark';
  const distance = source.distanceMeters >= 1000
    ? `${(source.distanceMeters / 1000).toFixed(1)} km`
    : `${source.distanceMeters} m`;
  return `Nearby ${kind} · ${distance}`;
}
