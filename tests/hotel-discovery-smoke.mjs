#!/usr/bin/env node
/** Offline regression for the bounded queued-hotel discovery sweep. */
import assert from 'node:assert/strict';

const ANCHOR_ID = 'TESTANCHOR0001';
const lodging = Array.from({ length: 25 }, (_, index) => ({
  id: `TESTHOTEL${String(index).padStart(6, '0')}`,
  displayName: { text: `Test Hotel ${index + 1}` },
  formattedAddress: `${index + 1} Test Road, Test City, Goa`,
  addressComponents: [
    { longText: 'Test City', types: ['locality'] },
    { longText: 'Goa', types: ['administrative_area_level_1'] },
  ],
  location: { latitude: 15.24 + index * 0.0001, longitude: 73.927 + index * 0.0001 },
  googleMapsUri: `https://www.google.com/maps/place/?q=place_id:TESTHOTEL${String(index).padStart(6, '0')}`,
  rating: 4,
  types: ['lodging', 'hotel'],
}));

const charger = {
  id: 'TESTCHARGER0001',
  displayName: { text: 'Test EV Charging Station' },
  location: { latitude: 15.2401, longitude: 73.9271 },
  googleMapsUri: 'https://www.google.com/maps/place/?q=place_id:TESTCHARGER0001',
  types: ['electric_vehicle_charging_station'],
};

let lodgingCalls = 0;
let chargerCalls = 0;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  const body = init?.body ? JSON.parse(init.body) : {};
  if (target.includes(`/places/${ANCHOR_ID}`)) {
    return Response.json({
      id: ANCHOR_ID,
      displayName: { text: 'Test Beach, Goa' },
      location: { latitude: 15.24, longitude: 73.927 },
      types: ['locality'],
    });
  }
  if (target.includes('places:searchNearby')) {
    if (body.includedTypes?.[0] === 'lodging') {
      lodgingCalls += 1;
      return Response.json({ places: lodging });
    }
    if (body.includedTypes?.[0] === 'electric_vehicle_charging_station') {
      chargerCalls += 1;
      return Response.json({ places: [charger] });
    }
  }
  return new Response('{}', { status: 400 });
};

const { discoverNearbyHotels, NEARBY_HOTEL_LIMIT, NEARBY_HOTEL_RADIUS_METERS } =
  await import('../server/lib/hotelDiscovery.ts');
const { hotelDiscoveryQueuePath } = await import('../server/lib/hotelDiscoveryQueue.ts');

const result = await discoverNearbyHotels(
  { placeId: ANCHOR_ID },
  'test-key',
  { delayMs: 0 }
);

assert.equal(result.anchor?.placeId, ANCHOR_ID, 'non-lodging anchors must still be queueable');
assert.equal(result.hotels.length, NEARBY_HOTEL_LIMIT, 'sweep must cap at 20 lodging rows');
assert.equal(lodgingCalls, 1, 'one nearby lodging call per anchor');
assert.equal(chargerCalls, NEARBY_HOTEL_LIMIT, 'one charger call per kept lodging');
assert.ok(
  result.hotels.every(hotel => hotel.evSignal === 'ev_charger_nearby' && !hotel.onSiteEvidence),
  'proximity alone must never become an on-site claim'
);
assert.ok(
  result.hotels.every(hotel => hotel.provenance.placeId.startsWith('TESTHOTEL')),
  'every row must keep its exact Google Place ID'
);

const anchor = {
  placeId: ANCHOR_ID,
  label: 'Test Beach, Goa',
  location: { lat: 15.24, lng: 73.927 },
};
const queuePath = hotelDiscoveryQueuePath(anchor);
assert.match(queuePath, /^hotel-discovery\/requests\/[a-f0-9]{20}\.json$/);
assert.equal(queuePath, hotelDiscoveryQueuePath({ ...anchor }), 'queue path must be stable');
assert.equal(NEARBY_HOTEL_RADIUS_METERS, 10000);

console.log(`Hotel discovery smoke passed: ${result.hotels.length} rows, ${chargerCalls} charger lookups, queue path ${queuePath}`);
