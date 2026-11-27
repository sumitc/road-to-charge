import type { Hotel } from '@/lib/hotelIndex';
import { placePhotoUrl } from '@/lib/placePhotos';

export const HOTEL_PHOTO_PLACEHOLDER = '/hotels/placeholder.svg';

/**
 * Prefer an already cached local thumb, then use the real Google Maps photo
 * through the existing server-side proxy. The API key never reaches the client.
 */
export function hotelPhotoUrl(hotel: Pick<Hotel, 'photo'>, width = 640): string {
  if (hotel.photo?.localPath) return hotel.photo.localPath;
  if (hotel.photo?.reference) return placePhotoUrl(hotel.photo.reference, width);
  return HOTEL_PHOTO_PLACEHOLDER;
}
