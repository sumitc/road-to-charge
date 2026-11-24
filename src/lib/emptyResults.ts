import { trackAmpo } from './analytics';

export type EmptyResultSurface = 'hotels' | 'search' | 'route';
export type EmptyResultReason = 'no_rows' | 'filters';

export type EmptyResultInfo = {
  surface: EmptyResultSurface;
  query?: string;
  placeId?: string;
  from?: string;
  to?: string;
  radiusKm?: number;
  filter?: string;
  reason?: EmptyResultReason;
};

/**
 * One consistent signal for "a user saw no results" across hotels, station
 * search and route planning. Vercel Analytics is our durable count (filterable
 * by surface), and the console line helps correlate a report with a session.
 * Only place/location labels are logged — never free-text notes or emails.
 */
export function trackEmptyResult(info: EmptyResultInfo): void {
  console.info('[AmpoZeroResults]', JSON.stringify(info));
  trackAmpo('zero_results', {
    surface: info.surface,
    query: info.query ?? null,
    place_id: info.placeId ?? null,
    from: info.from ?? null,
    to: info.to ?? null,
    radius_km: info.radiusKm ?? null,
    filter: info.filter ?? null,
    reason: info.reason ?? 'no_rows',
  });
}
