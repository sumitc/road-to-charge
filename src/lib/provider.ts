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
 * Some BEE/PDF-fed rows still arrive with a broken font ToUnicode mapping
 * (Latin Extended/Greek glyphs and control characters in place of English
 * text). The original spelling cannot be recovered reliably, so never show
 * the gibberish: fall back to the provider + locality for the name and to
 * city/state for the address. Genuine Indic scripts are left untouched.
 */
const GARBLED_TEXT_RE = /[\u0100-\u024F\u0370-\u03FF\x00-\x08\x0B\x0C\x0E-\x1F]/u;

export function hasGarbledText(value?: string | null): boolean {
  return GARBLED_TEXT_RE.test(value ?? '');
}

export function displayStationName(station: {
  name?: string | null;
  provider?: string | null;
  city?: string | null;
}): string {
  if (!hasGarbledText(station.name)) return station.name ?? 'Charging station';
  const provider = providerLabel(station.provider);
  const city = hasGarbledText(station.city) ? '' : (station.city ?? '').trim();
  return [provider ? `${provider} charging station` : 'EV charging station', city]
    .filter(Boolean)
    .join(', ');
}

export function displayStationAddress(station: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  if (!hasGarbledText(station.address)) {
    return station.address ?? station.city ?? 'Location on map';
  }
  return [station.city, station.state]
    .filter(value => value && !hasGarbledText(value))
    .join(', ') || 'Location on map';
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
