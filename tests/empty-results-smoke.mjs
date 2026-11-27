/**
 * Local-only regression checks for the "no results" UX and analytics signal.
 * External APIs are mocked so the counts are deterministic and offline.
 *
 *   npm run build
 *   npm run preview -- --port 4173 --host 127.0.0.1
 *   BASE_URL=http://127.0.0.1:4173 npm run test:empty
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const HOTEL_INDEX = JSON.parse(fs.readFileSync('src/data/hotels-ev.index.generated.json', 'utf8'));
const TOTAL_STAYS = HOTEL_INDEX.hotels.length;
const PHOTO_HOTEL = HOTEL_INDEX.hotels.find(hotel => hotel.photo?.reference) ?? HOTEL_INDEX.hotels[0];
const DETAIL_HOTEL = HOTEL_INDEX.hotels.find(hotel => /park continental/i.test(hotel.name)) ?? PHOTO_HOTEL;
const DISCOVERED_NEAREST = {
  ...(DETAIL_HOTEL.ev.nearestCharger ?? {}),
  placeId: 'test-zeon-charger',
  name: 'Zeon Charging Station',
  provider: 'Zeon',
  location: { lat: 15.2408, lng: 73.9271 },
  distanceMeters: 282,
  sourceUrl: 'https://www.google.com/maps/search/?api=1&query=Zeon%20Charging%20Station',
  source: 'Google Places API (New)',
  sourceKind: 'google',
  connectors: [],
};
const DISCOVERED_HOTEL = {
  ...DETAIL_HOTEL,
  id: 'google-test-azaya-place',
  name: 'Azaya Beach Resort Goa',
  area: 'Benaulim',
  city: 'Goa',
  state: 'Goa',
  locality: 'Benaulim',
  formattedAddress: 'Village, Calwaddo, Benaulim, Goa',
  location: { lat: 15.2410414, lng: 73.9273839 },
  interestTags: [],
  rating: 4,
  ratingSource: 'google',
  source: 'Google Places API (New) · discovered by search',
  sourceUrl: 'https://www.google.com/maps/place/?q=place_id:test-azaya-place',
  evSignal: 'ev_charger_nearby',
  onSiteEvidence: null,
  onSiteEvidenceSource: null,
  ev: {
    ...DETAIL_HOTEL.ev,
    label: 'EV charger 0.3 km away',
    nearestCharger: DISCOVERED_NEAREST,
    chargerCountWithinRadius: 1,
    providers: ['Zeon'],
    nearbyChargerSources: [DISCOVERED_NEAREST],
  },
  provenance: {
    ...DETAIL_HOTEL.provenance,
    placeId: 'test-azaya-place',
    retrievedAt: new Date().toISOString(),
    demandUrl: 'https://www.google.com/maps/place/?q=place_id:test-azaya-place',
    hotelLookup: 'Google Places API (New) place details',
    chargerLookup: 'Google Places API (New) places:searchNearby',
  },
};
const HOTEL_REVIEWS = Array.from({ length: 5 }, (_, index) => ({
  authorName: `Google Maps reviewer ${index + 1}`,
  rating: 5 - (index % 2),
  text: `A real Google Maps review about the property, number ${index + 1}.`,
  relativeTime: `${index + 1} month${index ? 's' : ''} ago`,
  googleMapsUri: `https://maps.google.com/?review=${index + 1}`,
}));

const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function newPage({ withRoute = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition(ok) { ok({ coords: { latitude: 17.42, longitude: 78.34 } }); } },
    });
    // Capture the full Vercel Analytics payload, not just event names.
    window.__ampoEvents = [];
    let current;
    Object.defineProperty(window, 'va', {
      configurable: true,
      get() { return current; },
      set(fn) {
        current = (...params) => {
          if (params[0] === 'event' && params[1]?.name) {
            window.__ampoEvents.push(params[1]);
          }
          return typeof fn === 'function' ? fn(...params) : undefined;
        };
      },
    });
  });
  await page.route('**/api/stations**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') === 'suggest') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const suggestions = q.includes('jaip')
        ? [{
          placeId: 'test-jaipur-area',
          label: 'Jaipur, Rajasthan, India',
          primaryText: 'Jaipur',
          secondaryText: 'Rajasthan, India',
        }]
        : q.includes('goa')
          ? [{
            placeId: 'test-goa-area',
            label: 'Goa, India',
            primaryText: 'Goa',
            secondaryText: 'India',
          }]
          : q.includes('azaya')
            ? [{
              placeId: 'test-azaya-place',
              label: 'Azaya Beach Resort Goa, Benaulim, Goa',
              primaryText: 'Azaya Beach Resort Goa',
              secondaryText: 'Benaulim, Goa',
            }]
            : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(suggestions) });
    }
    if (url.searchParams.get('mode') === 'resolve') {
      const placeId = url.searchParams.get('placeId');
      const place = placeId === 'test-goa-area'
        ? {
          placeId: 'test-goa-area',
          label: 'Goa, India',
          lat: 15.3,
          lng: 73.9,
        }
        : placeId === 'test-azaya-place'
          ? {
            placeId: 'test-azaya-place',
            label: 'Azaya Beach Resort Goa',
            lat: 15.2410414,
            lng: 73.9273839,
          }
          : null;
      return route.fulfill({
        status: place ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(place ?? { error: 'Place could not be resolved' }),
      });
    }
    if (url.searchParams.get('mode') === 'discover-hotel') {
      const placeId = url.searchParams.get('placeId');
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const found = placeId === 'test-azaya-place' || query.includes('azaya');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(found
          ? { hotel: DISCOVERED_HOTEL }
          : { hotel: null, reason: 'no_ev_data' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/router.project-osrm.org/table/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ distances: [] }),
  }));
  await page.route('**/api/place-photo?**', route => route.fulfill({
    status: 200,
    contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
  }));
  await page.route('**/api/station-reviews?placeId=**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reviews: HOTEL_REVIEWS, googleMapsUri: DETAIL_HOTEL.sourceUrl }),
  }));
  if (withRoute) {
    await page.route('**/nominatim.openstreetmap.org/search**', route => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? '';
      const point = /jaipur/i.test(q)
        ? { lat: '26.9124', lon: '75.7873', display_name: 'Jaipur, Rajasthan, India' }
        : { lat: '28.6139', lon: '77.2090', display_name: 'Delhi, India' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([point]) });
    });
    await page.route('**/router.project-osrm.org/route/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        routes: [{
          distance: 280000,
          duration: 14400,
          geometry: { coordinates: [[77.209, 28.6139], [76.5, 27.7], [75.7873, 26.9124]] },
        }],
      }),
    }));
  }
  return { page, context };
}

const zeroEvents = async page => (await page.evaluate(() => window.__ampoEvents ?? []))
  .filter(event => event.name === 'zero_results');

async function checkHotels() {
  const { page, context } = await newPage();
  await page.goto(`${BASE_URL}/hotels/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    total => document.body.innerText.includes(`${total} of ${total} stays`),
    TOTAL_STAYS,
    { timeout: 30000 },
  );

  check('EV evidence and provider filters are gone',
    (await page.locator('select[aria-label="EV signal"]').count()) === 0
      && (await page.locator('select[aria-label="Charging provider"]').count()) === 0);

  const initialBody = await page.locator('body').innerText();
  check('EV index badge is gone but honest per-hotel evidence tags remain',
    !initialBody.includes('EV INDEX') && initialBody.includes('Charger nearby'));
  check('on-site badges only appear for source-backed hotels',
    initialBody.includes('EV on site')
      && initialBody.includes('Marriott Bonvoy official property page')
      && !initialBody.includes('Google place text'));
  const evidenceTag = page.getByText('Charger nearby', { exact: true }).first();
  const evidenceClass = await evidenceTag.getAttribute('class');
  check('evidence tag is a small search-results-style pill',
    Boolean(evidenceClass?.includes('rounded-full') && evidenceClass.includes('text-[10px]')),
    evidenceClass ?? '');

  const photoCard = page.locator(`[data-hotel-card="${PHOTO_HOTEL.id}"]`);
  const photoSrc = await photoCard.locator('img').getAttribute('src');
  const photoRef = new URL(photoSrc ?? '', BASE_URL).searchParams.get('ref');
  check('hotel cards use real Google Maps photos through the existing proxy',
    decodeURIComponent(photoRef ?? '') === PHOTO_HOTEL.photo.reference,
    photoSrc ?? '');
  await photoCard.scrollIntoViewIfNeeded();
  const photoBox = await photoCard.locator('img').boundingBox();
  if (photoBox) {
    await page.mouse.click(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
    await page.waitForURL(url => url.pathname === `/hotels/${PHOTO_HOTEL.id}`, { timeout: 15000 });
    check('clicking any part of a hotel card opens the detail page',
      new URL(page.url()).pathname === `/hotels/${PHOTO_HOTEL.id}`, page.url());
    await page.goBack();
    await page.waitForFunction(
      total => document.body.innerText.includes(`${total} of ${total} stays`),
      TOTAL_STAYS,
      { timeout: 15000 },
    );
  }

  const radiusSelect = page.getByLabel('Search radius in kilometres');
  check('hotel search has the same distance control as stations',
    (await radiusSelect.inputValue()) === 'all'
      && (await radiusSelect.locator('option[value="5"]').count()) === 1
      && (await radiusSelect.locator('option[value="25"]').count()) === 1);
  check('hotel search shows the same radius pin icon as station search',
    (await radiusSelect.locator('xpath=..').locator('svg.lucide-map-pin').count()) === 1);
  check('hotel search drops the extra Google rating filter',
    (await page.getByLabel('Minimum Google rating').count()) === 0);
  check('hotel cards show distance from the active origin',
    (await page.locator('span[title="Straight-line distance"]').count()) > 0);
  check('hotel count names the distance origin',
    (await page.locator('body').innerText()).includes('distances from your location'));

  const connectorButton = page.getByRole('button', { name: /All connectors/ });
  check('connector filter replaces the provider box', (await connectorButton.count()) > 0);
  await connectorButton.click();
  await page.getByRole('button', { name: /Super-fast · CCS/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(total => {
    const match = document.body.innerText.match(new RegExp(`(\\d+) of ${total} stays`));
    return match && Number(match[1]) > 0 && Number(match[1]) < total;
  }, TOTAL_STAYS, { timeout: 15000 });
  const ccsCount = Number(((await page.locator('body').innerText()).match(new RegExp(`(\\d+) of ${TOTAL_STAYS} stays`)) ?? [])[1] ?? TOTAL_STAYS);
  check('connector filter narrows hotels using real Google connector data',
    ccsCount > 0 && ccsCount < TOTAL_STAYS, `${ccsCount} stays`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForFunction(
    total => document.body.innerText.includes(`${total} of ${total} stays`),
    TOTAL_STAYS,
    { timeout: 15000 },
  );

  const input = page.getByLabel('Search hotels by city or hotel name');
  check('hotels title is moved into the grey search placeholder',
    (await input.getAttribute('placeholder')) === 'Hotels with EV charging'
      && (await page.getByRole('heading', { name: 'Hotels with EV charging' }).count()) === 0);
  check('hotel search exposes exactly one Search button',
    (await page.getByRole('button', { name: 'Search', exact: true }).count()) === 1);
  await input.fill('jaip');
  const listbox = page.getByRole('listbox', { name: 'Matching hotel areas and places' });
  await listbox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check('hotel search shows Google suggestions while typing', await listbox.isVisible().catch(() => false));
  if (await listbox.isVisible().catch(() => false)) {
    const inputBox = await input.boundingBox();
    const dropdownBox = await listbox.boundingBox();
    check('hotel dropdown drops from the input edge',
      Boolean(inputBox && dropdownBox)
        && Math.abs(inputBox.x - dropdownBox.x) <= 2
        && Math.abs(inputBox.width - dropdownBox.width) <= 2
        && dropdownBox.y >= inputBox.y + inputBox.height - 2
        && dropdownBox.y <= inputBox.y + inputBox.height + 10,
      `input=${JSON.stringify(inputBox)} dropdown=${JSON.stringify(dropdownBox)}`);
    await listbox.getByRole('option').first().click();
    await page.waitForFunction(total => {
      const match = document.body.innerText.match(new RegExp(`(\\d+) of ${total} stays`));
      return match && Number(match[1]) > 0 && Number(match[1]) < total;
    }, TOTAL_STAYS, { timeout: 15000 });
    const pickedText = await page.locator('body').innerText();
    const pickedCount = Number((pickedText.match(new RegExp(`(\\d+) of ${TOTAL_STAYS} stays`)) ?? [])[1] ?? TOTAL_STAYS);
    check('picking a hotel-area suggestion narrows stays',
      pickedCount > 0 && pickedCount < TOTAL_STAYS, `${pickedCount} stays`);
    check('searched hotels hide the radius dropdown like station search',
      (await radiusSelect.count()) === 0);
  }

  await input.fill('Jaipur');
  await page.waitForFunction(
    total => document.body.innerText.includes(`of ${total} stays`),
    TOTAL_STAYS,
    { timeout: 15000 },
  );
  const jaipurText = await page.locator('body').innerText();
  const jaipurCount = Number((jaipurText.match(new RegExp(`(\\d+) of ${TOTAL_STAYS} stays`)) ?? [])[1] ?? 0);
  check('hotel list is queryable by city', jaipurCount > 0 && jaipurCount < TOTAL_STAYS, `${jaipurCount} stays`);

  await input.fill('zzzz-no-such-place');
  await page.waitForFunction(() => document.body.innerText.includes('No stays found'), null, { timeout: 15000 });
  const body = await page.locator('body').innerText();
  check('hotel empty state is friendly and actionable',
    body.includes('No stays found for “zzzz-no-such-place”')
      && body.includes('Try a city like Jaipur or a hotel name'),
    body.slice(body.indexOf('No stays found'), body.indexOf('No stays found') + 160).replace(/\n/g, ' '));

  const events = await zeroEvents(page);
  check('hotel zero-results event carries the query',
    events.some(event => event.data?.surface === 'hotels' && event.data?.query === 'zzzz-no-such-place'),
    JSON.stringify(events.slice(-3)));

  // Hotels must not add a second horizontal padding layer on top of EVApp's
  // main container — that squeezed cards versus the station search page.
  const hotelInputBox = await input.boundingBox();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const stationInput = page.getByLabel('Search for charging stations by area or city');
  await stationInput.waitFor({ timeout: 20000 });
  const stationInputBox = await stationInput.boundingBox();
  check('hotel sections use the same content width as station search',
    Boolean(hotelInputBox && stationInputBox)
      && Math.abs(hotelInputBox.x - stationInputBox.x) <= 1
      && Math.abs(hotelInputBox.width - stationInputBox.width) <= 1,
    `hotels=${JSON.stringify(hotelInputBox)} stations=${JSON.stringify(stationInputBox)}`);

  // Every tab gets its own URL, and browser history must follow the tabs.
  const expectPath = async (path, label) => {
    await page.waitForURL(url => new URL(url).pathname === path, { timeout: 15000 });
    check(`${label} tab changes the URL`, new URL(page.url()).pathname === path, page.url());
  };
  await page.getByRole('tab', { name: /Trip/i }).click();
  await expectPath('/trips/', 'Trips');
  await page.getByRole('tab', { name: /Saved/i }).click();
  await expectPath('/saved/', 'Saved');
  await page.getByRole('tab', { name: /Hotels/i }).click();
  await expectPath('/hotels/', 'Hotels');
  await page.getByRole('tab', { name: /Stations/i }).click();
  await expectPath('/', 'Stations');
  await page.goBack();
  await expectPath('/hotels/', 'Back');
  const activeTab = await page.locator('[role="tab"][data-state="active"]').innerText();
  check('Back restores the Hotels tab', /Hotels/i.test(activeTab), activeTab.replace(/\n/g, ' '));

  await input.fill('bangalore');
  await page.waitForFunction(total => {
    const match = document.body.innerText.match(new RegExp(`(\\d+) of ${total} stays`));
    return match && Number(match[1]) > 0 && Number(match[1]) < total;
  }, TOTAL_STAYS, { timeout: 15000 });
  const bengaluruCount = Number((await page.locator('body').innerText()).match(new RegExp(`(\\d+) of ${TOTAL_STAYS} stays`))?.[1] ?? 0);
  check('hotel search resolves Bangalore to the indexed Bengaluru stays',
    bengaluruCount > 0 && bengaluruCount < TOTAL_STAYS, `${bengaluruCount} stays`);

  await input.fill('goa');
  const goaListbox = page.getByRole('listbox', { name: 'Matching hotel areas and places' });
  await goaListbox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check('hotel autocomplete offers an Indian Goa suggestion',
    (await goaListbox.innerText().catch(() => '')).includes('India'));
  await goaListbox.getByRole('option').first().click();
  await page.waitForFunction(
    () => document.body.innerText.includes('distances from Goa, India'),
    null,
    { timeout: 15000 },
  );
  const goaBody = await page.locator('body').innerText();
  const goaCount = Number((goaBody.match(new RegExp(`(\\d+) of ${TOTAL_STAYS} stays`)) ?? [])[1] ?? 0);
  check('picked Goa anchors distances to the searched place, not the device',
    goaCount > 0 && goaCount < TOTAL_STAYS && goaBody.includes('distances from Goa, India'),
    `${goaCount} stays`);

  // Hotel-detail chargers must use the same card/actions/click-through as the
  // station search list, scoped to the hotel as the distance origin.
  await page.goto(new URL(`/hotels/${DETAIL_HOTEL.id}`, BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-hotel-maps-link]').waitFor({ timeout: 20000 });
  const detailPhotoRef = new URL(
    await page.locator('main img').first().getAttribute('src') ?? '',
    BASE_URL,
  ).searchParams.get('ref');
  check('hotel detail uses the real Google Maps photo',
    decodeURIComponent(detailPhotoRef ?? '') === DETAIL_HOTEL.photo.reference,
    detailPhotoRef ?? '');

  const detailEvidenceTag = page.locator('[data-hotel-evidence]');
  check('hotel detail shows only one EV evidence tag',
    (await detailEvidenceTag.count()) === 1 && /^(EV on site|Charger nearby)$/.test((await detailEvidenceTag.innerText()).trim()),
    (await detailEvidenceTag.allInnerTexts()).join(' | '));
  const evidenceBox = await detailEvidenceTag.boundingBox();
  const mapsBox = await page.locator('[data-hotel-maps-link]').boundingBox();
  check('Google Maps link sits directly beside the hotel EV tag',
    Boolean(evidenceBox && mapsBox && mapsBox.x > evidenceBox.x && Math.abs(mapsBox.y - evidenceBox.y) < 20),
    `tag=${JSON.stringify(evidenceBox)} maps=${JSON.stringify(mapsBox)}`);
  const detailMainText = await page.locator('main').innerText();
  check('hotel detail drops the duplicate tag, nearest panel and verbose address',
    !detailMainText.includes('Nearby public chargers, not an on-site claim')
      && !detailMainText.includes('NEAREST VERIFIED PUBLIC CHARGER')
      && (!DETAIL_HOTEL.formattedAddress || !detailMainText.includes(DETAIL_HOTEL.formattedAddress)),
    detailMainText.replace(/\n/g, ' ').slice(0, 220));

  const mapsHref = await page.locator('[data-hotel-maps-link]').getAttribute('href');
  check('top Google Maps button uses the exact sourced property link',
    mapsHref === DETAIL_HOTEL.sourceUrl,
    mapsHref ?? '');
  check('hotel detail drops the city charger shortcut and interest tags',
    (await page.getByRole('link', { name: /^Chargers in /i }).count()) === 0
      && DETAIL_HOTEL.interestTags.every(tag =>
        !new RegExp(`\\b${tag}\\b`, 'i').test(detailMainText)),
    DETAIL_HOTEL.interestTags.join(', '));

  const evidenceLink = page.locator('[data-hotel-evidence-link]');
  check('EV evidence badge is a shortcut to the charger list',
    (await evidenceLink.count()) === 1 && (await evidenceLink.getAttribute('href')) === '#chargers');
  const ratingLink = page.locator('[data-hotel-rating-link]');
  if (DETAIL_HOTEL.rating != null) {
    check('rating bubble is a shortcut to the reviews section',
      (await ratingLink.count()) === 1 && (await ratingLink.getAttribute('href')) === '#ratings');
  }
  const domOrder = await page.evaluate(() => {
    const tag = document.querySelector('[data-hotel-evidence]');
    const ratings = document.getElementById('ratings');
    const chargers = document.getElementById('chargers');
    const follows = (first, second) => Boolean(first && second
      && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING));
    return {
      tagBeforeRatings: follows(tag, ratings),
      ratingsBeforeChargers: follows(ratings, chargers),
    };
  });
  check('ratings section sits below the EV tag and above the charger list',
    domOrder.tagBeforeRatings && domOrder.ratingsBeforeChargers,
    JSON.stringify(domOrder));

  await page.locator('[data-hotel-review]').first().waitFor({ timeout: 20000 });
  const reviewsToggle = page.locator('[data-hotel-reviews-toggle]');
  check('reviews are an expanded accordion by default',
    (await reviewsToggle.getAttribute('aria-expanded')) === 'true');
  await reviewsToggle.click();
  check('reviews accordion collapses',
    (await reviewsToggle.getAttribute('aria-expanded')) === 'false'
      && (await page.locator('#hotel-reviews-body').count()) === 0);
  await reviewsToggle.click();
  check('reviews accordion reopens',
    (await reviewsToggle.getAttribute('aria-expanded')) === 'true'
      && (await page.locator('[data-hotel-review]').count()) === 3);
  const moreReviews = page.locator('[data-hotel-reviews-more]');
  check('reviews show three top entries with an inline see-more',
    (await page.locator('[data-hotel-review]').count()) === 3
      && (await moreReviews.innerText()).includes('See 2 more reviews'));
  await moreReviews.click();
  check('inline see-more expands the remaining real reviews',
    (await page.locator('[data-hotel-review]').count()) === HOTEL_REVIEWS.length
      && (await moreReviews.innerText()).includes('Show fewer reviews'));

  if (DETAIL_HOTEL.rating != null) {
    await ratingLink.click();
    await page.waitForFunction(() => {
      const section = document.getElementById('ratings');
      const rect = section?.getBoundingClientRect();
      return window.location.hash === '#ratings' && rect && rect.top >= -10 && rect.top < 180;
    }, null, { timeout: 10000 });
    check('rating bubble scrolls to the ratings section',
      new URL(page.url()).hash === '#ratings', page.url());
  }
  await evidenceLink.click();
  await page.waitForFunction(() => {
    const section = document.getElementById('chargers');
    const rect = section?.getBoundingClientRect();
    return window.location.hash === '#chargers' && rect && rect.top >= -10 && rect.top < 180;
  }, null, { timeout: 10000 });
  check('EV badge scrolls to the charger list',
    new URL(page.url()).hash === '#chargers', page.url());

  const chargerSectionClass = await page.locator('#chargers').getAttribute('class');
  check('hotel charger rows have no extra panel boundary around the search-style list',
    !/\b(bg-muted|rounded-xl|border|shadow|p-3)\b/.test(chargerSectionClass ?? ''),
    chargerSectionClass ?? '');
  check('hotel charger list starts with cards instead of a title and explanation',
    !detailMainText.includes('Public chargers near this property')
      && !detailMainText.includes('Google Places reports'));
  const chargerRows = page.locator('#chargers button[aria-label^="View details for"], #chargers button[aria-label^="Open charger source for"]');
  const chargerRow = chargerRows.first();
  await chargerRow.waitFor({ timeout: 20000 });
  check('hotel charger list uses the same station cards as search',
    (await chargerRow.count()) > 0,
    await chargerRow.getAttribute('aria-label') ?? '');
  check('nearest charger is ranked at the top of the same list',
    (await chargerRow.getAttribute('aria-label') ?? '').includes(DETAIL_HOTEL.ev.nearestCharger.name),
    `${await chargerRow.getAttribute('aria-label')} vs ${DETAIL_HOTEL.ev.nearestCharger.name}`);
  check('hotel charger cards expose the search-list actions',
    (await page.locator('#chargers button:has-text("Directions")').count()) > 0
      && (await page.locator('#chargers button:has-text("App")').count()) > 0);
  const detailRow = page.locator('#chargers button[aria-label^="View details for"]').first();
  if (await detailRow.count()) {
    await detailRow.click();
    await page.waitForURL(/\/station\/[0-9a-f-]{36}/, { timeout: 15000 });
    check('hotel charger row click-out opens the Ampo station detail',
      /\/station\//.test(page.url()), page.url());
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/hotels/${DETAIL_HOTEL.id}`, { timeout: 15000 });
    check('Back from a hotel charger returns to the hotel detail, not the search list',
      new URL(page.url()).pathname === `/hotels/${DETAIL_HOTEL.id}`, page.url());
  }
  await context.close();
}

async function checkHotelDiscovery() {
  const { page, context } = await newPage();
  await page.goto(`${BASE_URL}/hotels/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    total => document.body.innerText.includes(`${total} of ${total} stays`),
    TOTAL_STAYS,
    { timeout: 30000 },
  );

  const input = page.getByLabel('Search hotels by city or hotel name');
  await input.fill('Azaya Beach Resort');
  const listbox = page.getByRole('listbox', { name: 'Matching hotel areas and places' });
  await listbox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check('autocomplete offers stays outside the curated index',
    (await listbox.innerText().catch(() => '')).includes('Azaya Beach Resort'));
  await listbox.getByRole('option').first().click();

  const card = page.locator(`[data-hotel-card="${DISCOVERED_HOTEL.id}"]`);
  await card.waitFor({ state: 'visible', timeout: 20000 });
  const body = await page.locator('body').innerText();
  check('picking an unindexed stay adds one verified row',
    body.includes(`1 of ${TOTAL_STAYS + 1} stays`), body.slice(0, 180).replace(/\n/g, ' '));
  check('discovered stay keeps the honest nearby-charger evidence',
    (await card.innerText()).includes('Charger nearby')
      && (await card.innerText()).includes('Zeon Charging Station'));

  const detailHref = await card.locator('a[aria-label^="View details for"]').getAttribute('href');
  check('discovered stay links to its own detail route',
    detailHref === `/hotels/${DISCOVERED_HOTEL.id}`, detailHref ?? '');
  await card.locator('a[aria-label^="View details for"]').click();
  await page.waitForURL(url => url.pathname === `/hotels/${DISCOVERED_HOTEL.id}`, { timeout: 15000 });
  const heading = page.getByRole('heading', { name: DISCOVERED_HOTEL.name });
  await heading.waitFor({ timeout: 20000 });
  check('discovered stay opens a real detail page', await heading.isVisible());
  check('discovered detail keeps the exact Google Maps source',
    (await page.locator('[data-hotel-maps-link]').getAttribute('href')) === DISCOVERED_HOTEL.sourceUrl);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await heading.waitFor({ timeout: 20000 });
  check('discovered detail survives a reload through its exact Place ID',
    await page.getByRole('heading', { name: DISCOVERED_HOTEL.name }).isVisible());
  await context.close();
}

async function checkSearch() {
  const { page, context } = await newPage();
  await page.goto(`${BASE_URL}/?q=zzzz-no-such-place`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('No charging stations found near “zzzz-no-such-place”'),
    null,
    { timeout: 30000 },
  );
  const body = await page.locator('body').innerText();
  check('search empty state names the failed query and suggests alternatives',
    body.includes('Try a nearby area, a different spelling, or a larger radius'));
  const events = await zeroEvents(page);
  check('search zero-results event carries query and radius',
    events.some(event => event.data?.surface === 'search'
      && event.data?.query === 'zzzz-no-such-place'
      && event.data?.radius_km === 5),
    JSON.stringify(events.slice(-3)));
  await context.close();
}

async function checkRoute() {
  const { page, context } = await newPage({ withRoute: true });
  await page.goto(`${BASE_URL}/?from=Delhi&to=Jaipur`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('No public chargers found along this route yet'),
    null,
    { timeout: 45000 },
  );
  const body = await page.locator('body').innerText();
  check('route empty state explains that only real public chargers are shown',
    body.includes('Ampo only shows real public charging stations'));
  const events = await zeroEvents(page);
  check('route zero-results event carries both endpoints',
    events.some(event => event.data?.surface === 'route'
      && event.data?.from === 'Delhi' && event.data?.to === 'Jaipur'),
    JSON.stringify(events.slice(-3)));
  await context.close();
}

try {
  await checkHotels();
  await checkHotelDiscovery();
  await checkSearch();
  await checkRoute();
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll zero-result checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
