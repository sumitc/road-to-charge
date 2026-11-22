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

/**
 * `ownership` is operator ownership, not rider access, so it is deliberately
 * ignored. Only explicit OSM access values and strong residential keywords
 * produce this tag — e.g. "Aparna Cyber Life Residency RWA B Block Basement".
 */
export function accessTag(station: {
  name?: string | null;
  address?: string | null;
  access?: string | null;
}): string | null {
  const access = (station.access ?? '').toLowerCase().trim();
  if (['private', 'no', 'restricted', 'customers', 'members', 'permit'].includes(access)) {
    return 'Restricted access';
  }

  const text = `${station.name ?? ''} ${station.address ?? ''}`.toLowerCase();
  const strong = /\b(residency|rwa|apartment|apartments|gated|housing society|residents?|residential complex)\b/;
  const hasBasement = /\bbasement\b/.test(text);
  const residentialContext = /\b(society|residency|apartment|rwa|tower|block)\b/.test(text);
  if (strong.test(text) || (hasBasement && residentialContext)) return 'Restricted access';

  return null;
}
