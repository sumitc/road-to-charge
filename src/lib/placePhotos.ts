/** URL for a Google Places photo through the server-side proxy. */
export function placePhotoUrl(ref: string, width = 640): string {
  return `/api/place-photo?ref=${encodeURIComponent(ref)}&width=${width}`;
}
