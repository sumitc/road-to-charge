/**
 * The 31 Google Places catalog gap-fill rows have no real charging network.
 * Showing "Google Places" as their provider repeats on every Kokapet card and
 * is misleading — the actual site/brand is already in the station name.
 */
export function providerLabel(provider?: string): string | null {
  if (!provider) return null;
  if (provider.toLowerCase() === 'google places') return null;
  return provider;
}
