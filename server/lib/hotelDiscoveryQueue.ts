/**
 * Durable demand queue for hotel discovery.
 *
 * The Hotels tab calls discoverHotel() for a Google place that is not in our
 * generated index. That resolution is written as a small Vercel Blob object so
 * a manual/local script can later sweep up to 20 lodgings within 10 km, enrich
 * them from Google, and merge them into the generated hotel index. The store is
 * public-only, so the path is a content hash and the payload is public place
 * data. No new Vercel function and no DB migration.
 */
import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import type { HotelDiscoveryAnchor } from './hotelDiscovery.js';

export const HOTEL_DISCOVERY_QUEUE_PREFIX = 'hotel-discovery/requests/';

export type HotelDiscoveryQueueItem = HotelDiscoveryAnchor & {
  schema: 1;
  surface: 'hotels';
  reason: string;
  queuedAt: string;
};

/** Stable key means repeat searches do not spam the queue while it is pending. */
export function hotelDiscoveryQueuePath(anchor: HotelDiscoveryAnchor): string {
  const identity = anchor.placeId || `${anchor.label}|${anchor.location.lat.toFixed(4)},${anchor.location.lng.toFixed(4)}`;
  const hash = createHash('sha256').update(identity.toLowerCase()).digest('hex').slice(0, 20);
  return `${HOTEL_DISCOVERY_QUEUE_PREFIX}${hash}.json`;
}

export async function queueHotelDiscovery(
  anchor: HotelDiscoveryAnchor,
  reason: string
): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;

  const item: HotelDiscoveryQueueItem = {
    schema: 1,
    surface: 'hotels',
    reason,
    queuedAt: new Date().toISOString(),
    ...anchor,
  };

  try {
    await put(hotelDiscoveryQueuePath(anchor), JSON.stringify(item), {
      // This project's Blob store is public-only. The content is public place
      // data and the path is a content hash, not a secret.
      access: 'public',
      contentType: 'application/json',
      token,
      addRandomSuffix: false,
      // The selected path is content-addressed; a second search is a no-op.
      allowOverwrite: false,
      cacheControlMaxAge: 60,
    });
    return true;
  } catch (error) {
    const message = String(error);
    // Already queued is the expected repeated-search case.
    if (/already exists|precondition|conflict/i.test(message)) return false;
    console.error('[AmpoHotelDiscoveryQueue] could not queue anchor:', message);
    return false;
  }
}
