/**
 * Common Indian city spellings. The first entry is the canonical form used for
 * geocoding; the rest are aliases people actually type. Shared by station and
 * hotel search so "bangalore" and "Bengaluru" resolve consistently.
 */
export const PLACE_ALIASES: Record<string, string[]> = {
  bangalore: ['bangalore', 'bengaluru'],
  bengaluru: ['bengaluru', 'bangalore'],
  bombay: ['bombay', 'mumbai'],
  mumbai: ['mumbai', 'bombay'],
  madras: ['madras', 'chennai'],
  chennai: ['chennai', 'madras'],
  calcutta: ['calcutta', 'kolkata'],
  kolkata: ['kolkata', 'calcutta'],
  cochin: ['cochin', 'kochi'],
  kochi: ['kochi', 'cochin'],
  trivandrum: ['trivandrum', 'thiruvananthapuram'],
  thiruvananthapuram: ['thiruvananthapuram', 'trivandrum'],
  gurgaon: ['gurgaon', 'gurugram'],
  gurugram: ['gurugram', 'gurgaon'],
  mysore: ['mysore', 'mysuru'],
  mysuru: ['mysuru', 'mysore'],
  baroda: ['baroda', 'vadodara'],
  vadodara: ['vadodara', 'baroda'],
  pondicherry: ['pondicherry', 'puducherry'],
  puducherry: ['puducherry', 'pondicherry'],
  nallagandla: ['nallagandla', 'nalagandla'],
  nalagandla: ['nallagandla', 'nalagandla'],
};

/**
 * Every typed token must be satisfied, but an alias token only needs ONE of
 * its known spellings. Requiring all variants would make "bangalore" demand
 * both "bangalore" and "Bengaluru" in the same row.
 */
export function matchesPlaceQuery(haystack: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = haystack.toLowerCase();
  return tokens.length > 0
    && tokens.every(token => (PLACE_ALIASES[token] ?? [token]).some(variant => text.includes(variant)));
}
