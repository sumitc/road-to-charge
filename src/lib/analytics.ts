import { track } from '@vercel/analytics/react';

/** Funnel events we deliberately measure for Ampo growth. Keep names stable. */
export type AmpoEvent =
  | 'place_selected'
  | 'search_submit'
  | 'show_nearby'
  | 'detail_open'
  | 'directions_click'
  | 'feedback_submit'
  | 'charger_submitted'
  | 'search_shared'
  | 'link_shared'
  | 'zero_results';

type EventProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Vercel Analytics accepts flat primitives only. Trim long labels (station
 * names/queries can be huge) and drop empty values so the dashboard stays
 * readable and we never send free-text notes or emails.
 */
const compact = (properties: EventProperties): EventProperties =>
  Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.slice(0, 120) : value,
      ]),
  );

/** Single entry point so every event goes through the same sanitising rules. */
export const trackAmpo = (event: AmpoEvent, properties: EventProperties = {}): void => {
  track(event, compact(properties));
};
