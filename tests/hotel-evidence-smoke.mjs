/**
 * Data-only guardrails for hotel EV evidence.
 *
 * Run: npm run test:hotel-evidence
 *
 * Proximity is never an on-site claim. Every "EV on site" row must carry a
 * property-specific source URL and quote from an official hotel/brand page or
 * Google Place details.
 */
import fs from 'node:fs';

const index = JSON.parse(fs.readFileSync('src/data/hotels-ev.index.generated.json', 'utf8'));

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const ON_SITE_SIGNALS = new Set(['both', 'on_site_google_place', 'on_site_official_source']);
const onSite = index.hotels.filter(hotel => ON_SITE_SIGNALS.has(hotel.evSignal));
const nearby = index.hotels.filter(hotel => hotel.evSignal === 'ev_charger_nearby');

check('hotel index has rows', index.hotels.length > 0, `${index.hotels.length} stays`);
check('nearby rows exist and keep a real nearest charger',
  nearby.length > 0 && nearby.every(hotel => hotel.ev?.nearestCharger),
  `${nearby.length} nearby`);

check('proximity-only rows never claim on-site charging',
  nearby.every(hotel => !hotel.onSiteEvidence && !hotel.onSiteEvidenceSource),
  `${nearby.filter(hotel => hotel.onSiteEvidence).length} nearby rows with evidence text`);

check('very close chargers still stay nearby without a source',
  nearby.filter(hotel => hotel.ev.nearestCharger.distanceMeters <= 250)
    .every(hotel => !hotel.onSiteEvidenceSource),
  `${nearby.filter(hotel => hotel.ev.nearestCharger.distanceMeters <= 250).length} within 250 m`);

check('on-site rows carry a quote and source URL',
  onSite.length > 0 && onSite.every(hotel =>
    hotel.onSiteEvidence
    && hotel.onSiteEvidenceSource?.quote
    && hotel.onSiteEvidenceSource?.url
  ),
  `${onSite.length} on-site`);

check('on-site sources are authentic property/brand or Google Place records',
  onSite.every(hotel => ['official_property_page', 'google_places_place_id']
    .includes(hotel.onSiteEvidenceSource?.verificationMethod)),
  onSite.map(hotel => hotel.onSiteEvidenceSource?.verificationMethod).join(', '));

check('official-property evidence is present',
  onSite.some(hotel => hotel.onSiteEvidenceSource?.verificationMethod === 'official_property_page'));

check('chargers are enriched from the Ampo station DB',
  (index.coverage?.chargerSourceRows?.db ?? 0) > 0
  && index.hotels.some(hotel => (hotel.ev.nearbyChargerSources ?? []).some(charger => charger.sourceKind === 'db')),
  JSON.stringify(index.coverage?.chargerSourceRows ?? {}));

if (failures > 0) {
  console.error(`${failures} hotel evidence check(s) failed`);
  process.exit(1);
}
console.log('All hotel evidence checks passed');
