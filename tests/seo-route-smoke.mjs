/**
 * Local-only SEO / Hotels / route-link regression checks.
 *
 *   npm run build
 *   npm run preview -- --port 4173 --host 127.0.0.1
 *   BASE_URL=http://127.0.0.1:4173 npm run test:seo
 *
 * External APIs are mocked so the checks are deterministic and work offline.
 * This does not call Vercel, Supabase, Google, Nominatim or OSRM.
 */
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

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

async function newPage(detailRow = null) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(ok) {
          ok({ coords: { latitude: 17.42, longitude: 78.34 } });
        },
      },
    });
    // Headless desktop Chrome: force the copy-link fallback so share checks
    // never open a platform share sheet.
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });

  const counters = { route: 0 };
  await page.route('**/nominatim.openstreetmap.org/search**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const point = /jaipur/i.test(q)
      ? { lat: '26.9124', lon: '75.7873', display_name: 'Jaipur, Rajasthan, India' }
      : /delhi/i.test(q)
        ? { lat: '28.6139', lon: '77.2090', display_name: 'Delhi, India' }
        : /bengaluru|bangalore/i.test(q)
          ? { lat: '12.9716', lon: '77.5946', display_name: 'Bengaluru, Karnataka, India' }
          : { lat: '17.3850', lon: '78.4867', display_name: 'Hyderabad, Telangana, India' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([point]) });
  });
  await page.route('**/router.project-osrm.org/route/**', route => {
    counters.route++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        routes: [{
          distance: 280000,
          duration: 14400,
          geometry: {
            coordinates: [[77.209, 28.6139], [76.5, 27.7], [75.7873, 26.9124]],
          },
        }],
      }),
    });
  });
  await page.route('**/api/place-photo?**', route => route.fulfill({
    status: 200,
    contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
  }));
  await page.route('**/api/stations**', route => {
    const url = new URL(route.request().url());
    if (detailRow && url.searchParams.get('mode') === 'id'
      && url.searchParams.get('id') === detailRow.id) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailRow),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  return { page, counters };
}

async function metaOf(page) {
  return page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '',
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(script => {
      try { return JSON.parse(script.textContent ?? '{}'); } catch { return {}; }
    }),
  }));
}

async function copiedHeaderShareUrl(page) {
  await page.getByRole('button', { name: 'Share this view' }).click();
  return page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
}

async function checkStaticAssets() {
  const robots = await fetch(`${BASE_URL}/robots.txt`).then(r => r.text());
  check('robots.txt advertises the sitemap', /Sitemap:\s*https:\/\/ampo\.vercel\.app\/sitemap\.xml/.test(robots));
  check('robots.txt allows answer-engine crawlers',
    ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot'].every(bot =>
      new RegExp(`User-agent: ${bot}[\\s\\S]*?Allow: /`).test(robots)));

  const sitemap = await fetch(`${BASE_URL}/sitemap.xml`).then(r => r.text());
  const urlCount = (sitemap.match(/<url>/g) ?? []).length;
  const registry = JSON.parse(await fs.readFile('src/data/seoPages.json', 'utf8'));
  const hotels = JSON.parse(await fs.readFile('src/data/hotels-ev.index.generated.json', 'utf8'));
  const stations = JSON.parse(await fs.readFile('src/data/stations-seo.generated.json', 'utf8'));
  const expectedUrls = 2 + registry.searchPages.length + registry.routePages.length
    + registry.hubPages.length + hotels.hotels.length + stations.stations.length;
  check('sitemap includes all generated pages', urlCount === expectedUrls, `${urlCount}/${expectedUrls} URLs`);
  check('sitemap XML-escapes canonical query URLs',
    sitemap.includes('https://ampo.vercel.app/?q=Delhi&amp;place=ChIJL_P_CXMEDTkRw0ZdG-0GVvw'));
  check('sitemap includes hotel detail pages', sitemap.includes('<loc>https://ampo.vercel.app/hotels/google-'));
  check('sitemap includes quality-gated station detail pages',
    sitemap.includes('<loc>https://ampo.vercel.app/station/'));

  const llms = await fetch(`${BASE_URL}/llms.txt`).then(r => r.text());
  check('llms.txt points to canonical Ampo URLs',
    llms.includes('Canonical site: https://ampo.vercel.app') && llms.includes('?from=Hyderabad&amp;to=') === false
      && llms.includes('?from=Hyderabad&to=Bengaluru'));

  const shell = await fs.readFile('dist/seo/search/delhi.html', 'utf8');
  check('curated shell has a unique static title/canonical',
    shell.includes('<title>EV Charging Stations in Delhi | Ampo</title>')
      && shell.includes('href="https://ampo.vercel.app/?q=Delhi&amp;place=ChIJL_P_CXMEDTkRw0ZdG-0GVvw"'));
  check('dist shell loads hashed Vite assets', shell.includes('/assets/') && !shell.includes('/src/main.tsx'));
  check('static shell JSON-LD is marked for hydration cleanup',
    shell.includes('data-ampo-seo="static"'));

  const config = JSON.parse(await fs.readFile('vercel.json', 'utf8'));
  const queryRoutes = (config.routes ?? []).filter(r => r.has?.length);
  const fsHandleAt = (config.routes ?? []).findIndex(r => r.handle === 'filesystem');
  // `rewrites` would be evaluated AFTER a filesystem hit on /index.html, so
  // curated query URLs would silently serve the generic shell.
  check('vercel.json keeps curated query routes ahead of filesystem and SPA fallback',
    queryRoutes.length === 34
      && fsHandleAt === 35
      && (config.routes ?? []).at(-1)?.src === '/(.*)'
      && (config.rewrites ?? []).length === 0
      && config.crons?.length === 2,
    `${queryRoutes.length} query routes, filesystem at ${fsHandleAt}`);
  const stationRouteIndex = (config.routes ?? []).findIndex(route =>
    route.src?.startsWith('/station/') && route.dest === '/station/$1.html');
  check('vercel.json maps clean station URLs to static shells before SPA fallback',
    stationRouteIndex === 34 && stationRouteIndex < fsHandleAt,
    `station route at ${stationRouteIndex}, filesystem at ${fsHandleAt}`);

  const station = stations.stations[0];
  const stationShell = await fs.readFile(`dist/station/${station.id}.html`, 'utf8');
  check('station shell has its own canonical, query map and JSON-LD',
    stationShell.includes(`href="https://ampo.vercel.app/station/${station.id}"`)
      && stationShell.includes('ampo-query-map')
      && stationShell.includes('data-ampo-seo="static"')
      && stationShell.includes('point-in-time catalogue entry'));
  const queryLinks = [...stationShell.matchAll(/href="\/\?([^"]+)"/g)].map(match => match[1]);
  check('station query map only links curated place-locked searches',
    queryLinks.every(query => query.includes('place=')),
    queryLinks.join(' | ') || 'no query links');
}

async function checkCuratedSearch() {
  const { page } = await newPage();
  await page.goto(`${BASE_URL}/?q=Delhi&place=ChIJL_P_CXMEDTkRw0ZdG-0GVvw`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('Delhi'), null, { timeout: 15000 });
  const meta = await metaOf(page);
  check('curated search has unique live title/description',
    meta.title === 'EV Charging Stations in Delhi | Ampo'
      && meta.description.includes('Delhi'),
    meta.title);
  check('curated search canonicalises to the place-locked URL',
    meta.canonical === 'https://ampo.vercel.app/?q=Delhi&place=ChIJL_P_CXMEDTkRw0ZdG-0GVvw',
    meta.canonical);
  check('curated search is indexable with one JSON-LD block',
    meta.robots !== 'noindex,follow'
      && meta.jsonLd.length === 1
      && meta.jsonLd[0]['@type'] === 'CollectionPage',
    JSON.stringify(meta.jsonLd.map(item => item['@type'])));
  check('curated search updates Open Graph metadata',
    meta.ogTitle === meta.title);
  const copiedSearch = await copiedHeaderShareUrl(page);
  check('header share copies the current search URL',
    copiedSearch.includes('q=Delhi') && copiedSearch.includes('place=ChIJL_P_CXMEDTkRw0ZdG-0GVvw'),
    copiedSearch);
  await page.close();
}

async function checkArbitraryQuery() {
  const { page } = await newPage();
  await page.goto(`${BASE_URL}/?q=definitely-not-a-curated-place`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('meta[name="robots"]')?.getAttribute('content') === 'noindex,follow',
    null,
    { timeout: 15000 },
  );
  const meta = await metaOf(page);
  check('arbitrary search is noindex,follow',
    meta.robots === 'noindex,follow', meta.robots);
  check('arbitrary search canonicalises to the homepage',
    meta.canonical === 'https://ampo.vercel.app/', meta.canonical);
  check('arbitrary search does not emit derived structured data',
    meta.jsonLd.length === 0, `${meta.jsonLd.length} blocks`);
  await page.close();
}

async function checkHubsAndHotels() {
  const hotelIndex = JSON.parse(await fs.readFile('src/data/hotels-ev.index.generated.json', 'utf8'));
  const hotel = hotelIndex.hotels.find(item => item.tripadvisorUrl) ?? hotelIndex.hotels[0];

  const { page } = await newPage();
  await page.goto(`${BASE_URL}/ev-charging/ev-charging-near-me/`, { waitUntil: 'domcontentloaded' });
  const hubH1 = await page.locator('main h1').first().innerText({ timeout: 15000 });
  check('hub page renders a curated EV guide', /EV charging stations near me/i.test(hubH1), hubH1);
  const hubMeta = await metaOf(page);
  check('hub page canonicalises to its clean path',
    hubMeta.canonical === 'https://ampo.vercel.app/ev-charging/ev-charging-near-me/',
    hubMeta.canonical);
  await page.close();

  const hotels = await newPage();
  await hotels.page.goto(`${BASE_URL}/hotels/`, { waitUntil: 'domcontentloaded' });
  await hotels.page.waitForFunction(
    expected => document.body.innerText.includes(expected),
    `${hotelIndex.hotels.length} of ${hotelIndex.hotels.length} stays`,
    { timeout: 15000 },
  );
  const hotelText = await hotels.page.locator('body').innerText();
  check('published Hotels tab uses the real Google Places index',
    hotelText.includes(`${hotelIndex.hotels.length} of ${hotelIndex.hotels.length} stays`)
      && hotelText.includes('Google Places'),
    hotelText.slice(0, 120).replace(/\n/g, ' '));
  const hotelsMeta = await metaOf(hotels.page);
  check('hotel index has its own canonical',
    hotelsMeta.canonical === 'https://ampo.vercel.app/hotels/', hotelsMeta.canonical);
  const copiedHotels = await copiedHeaderShareUrl(hotels.page);
  check('header share copies the hotel list URL',
    new URL(copiedHotels, BASE_URL).pathname === '/hotels/', copiedHotels);
  await hotels.page.close();

  const detail = await newPage();
  await detail.page.goto(`${BASE_URL}/hotels/${hotel.id}/`, { waitUntil: 'domcontentloaded' });
  await detail.page.waitForFunction(
    () => document.body.innerText.includes('NEAREST VERIFIED PUBLIC CHARGER')
      || document.body.innerText.includes('Source: Google Places API'),
    null,
    { timeout: 15000 },
  );
  if (hotel.photo?.reference) {
    const detailPhotoSrc = await detail.page.locator('main img').first().getAttribute('src');
    check('hotel pages use real Google Maps photos through the existing proxy',
      decodeURIComponent(new URL(detailPhotoSrc ?? '', BASE_URL).searchParams.get('ref') ?? '') === hotel.photo.reference,
      detailPhotoSrc ?? '');
  }
  const detailText = await detail.page.locator('body').innerText();
  check('hotel detail keeps honest nearby-charger provenance',
    detailText.includes('nearby public charger') || detailText.includes('nearby charger')
      ? !/on-site EV charging/i.test(detailText)
      : /Google Maps source/.test(detailText),
    detailText.slice(0, 140).replace(/\n/g, ' '));
  check('hotel detail exposes charger sources and a contribution path',
    /Public chargers near this property/i.test(detailText)
      && detailText.includes('submit a location')
      && (await detail.page.getByRole('button', { name: 'Add a charging station' }).count()) === 1);
  if (hotel.tripadvisorUrl) {
    check('verified Tripadvisor link is present only when sourced',
      (await detail.page.locator(`a[href="${hotel.tripadvisorUrl}"]`).count()) > 0);
  }
  const detailMeta = await metaOf(detail.page);
  check('hotel detail JSON-LD describes a Place',
    detailMeta.jsonLd.some(item => item['@type'] === 'Place'),
    JSON.stringify(detailMeta.jsonLd.map(item => item['@type'])));
  await detail.page.close();
}

async function checkRouteLinks() {
  const shared = await newPage();
  await shared.page.goto(`${BASE_URL}/?from=Delhi&to=Jaipur`, { waitUntil: 'domcontentloaded' });
  await shared.page.waitForFunction(() => document.title.includes('Delhi to Jaipur'), null, { timeout: 15000 });
  const activeTab = await shared.page.locator('[role="tab"][data-state="active"]').innerText();
  check('?from=&to= opens the Trips tab', /Trip/i.test(activeTab), activeTab.replace(/\n/g, ' '));
  check('?from=&to= prefills both inputs',
    (await shared.page.locator('#start-location').inputValue()) === 'Delhi'
      && (await shared.page.locator('#end-location').inputValue()) === 'Jaipur');
  await shared.page.waitForFunction(
    () => document.body.innerText.includes('280.0 km'),
    null,
    { timeout: 20000 },
  );
  check('?from=&to= plans the route automatically with a mocked OSRM response',
    await shared.page.getByText('280.0 km', { exact: true }).count() > 0);
  check('auto-plan issues exactly one route request', shared.counters.route === 1, `${shared.counters.route} calls`);
  check('route URL is preserved after auto-plan',
    new URL(shared.page.url()).searchParams.get('from') === 'Delhi'
      && new URL(shared.page.url()).searchParams.get('to') === 'Jaipur');
  const routeMeta = await metaOf(shared.page);
  check('curated route has its own canonical and JSON-LD',
    routeMeta.canonical === 'https://ampo.vercel.app/?from=Delhi&to=Jaipur'
      && routeMeta.jsonLd.some(item => item['@type'] === 'WebPage'),
    routeMeta.canonical);
  const copiedRoute = await copiedHeaderShareUrl(shared.page);
  check('header share copies the planned route URL',
    copiedRoute.includes('from=Delhi') && copiedRoute.includes('to=Jaipur'), copiedRoute);
  await shared.page.close();

  const manual = await newPage();
  await manual.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await manual.page.getByRole('tab', { name: /Trip/i }).click();
  await manual.page.locator('#start-location').fill('Delhi');
  await manual.page.locator('#end-location').fill('Jaipur');
  await manual.page.getByRole('button', { name: 'Plan Trip' }).click();
  await manual.page.waitForFunction(
    () => document.body.innerText.includes('280.0 km'),
    null,
    { timeout: 20000 },
  );
  check('manual trip planning writes the same shareable URL',
    new URL(manual.page.url()).searchParams.get('from') === 'Delhi'
      && new URL(manual.page.url()).searchParams.get('to') === 'Jaipur',
    manual.page.url());
  check('manual plan also issues exactly one route request',
    manual.counters.route === 1, `${manual.counters.route} calls`);
  await manual.page.close();
}

function stationDetailRow(station) {
  const now = station.updatedAt ?? new Date().toISOString();
  return {
    id: station.id,
    station_name: station.name,
    provider: station.provider,
    address: station.address,
    city: station.city,
    state: station.state,
    district: station.district,
    latitude: station.lat,
    longitude: station.lng,
    connector_types: station.connectorTypes,
    availability_status: 'operational',
    connectors: null,
    max_power_kw: station.maxPowerKw,
    max_kw_by_standard: null,
    total_chargers: null,
    total_connectors: station.totalConnectors,
    vehicle_classes: null,
    charging_current: null,
    ownership: null,
    location_quality: null,
    mixed_admin: false,
    opening_hours: null,
    payment_modes: null,
    contact_numbers: null,
    staff: null,
    access: null,
    fee: null,
    station_type: 'charging',
    available_count: null,
    out_of_service_count: null,
    availability_last_update: null,
    last_rider_report: null,
    data_as_of: null,
    maps_link: station.mapsLink,
    external_id: station.googlePlaceId,
    pricing: null,
    power_output: station.maxPowerKw ? `${station.maxPowerKw}kW` : null,
    source_name: station.sourceName,
    source_url: station.sourceUrl,
    google_place_id: station.googlePlaceId,
    photo_references: station.photoRef ? [station.photoRef] : [],
    place_details: null,
    photo_enriched_at: null,
    created_at: now,
    updated_at: now,
  };
}

async function checkStationDetailSeo() {
  const snapshot = JSON.parse(await fs.readFile('src/data/stations-seo.generated.json', 'utf8'));
  const station = snapshot.stations[0];
  const canonical = `https://ampo.vercel.app/station/${station.id}`;
  const { page } = await newPage(stationDetailRow(station));
  await page.route('**/api/station-reviews**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"reviews":[]}' }));
  await page.route('**/api/station-feedback**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"total":0,"recent":[]}' }));
  await page.goto(`${BASE_URL}/station/${station.id}`, { waitUntil: 'domcontentloaded' });
  // The dist shell hands off to React, which replaces the static JSON-LD with
  // the live station payload. Wait for that hydration rather than reading the
  // shell's canonical alone.
  await page.waitForFunction(
    expected => document.querySelector('link[rel="canonical"]')?.getAttribute('href') === expected
      && [...document.querySelectorAll('script[type="application/ld+json"]')].some(script => {
        if (script.dataset.ampoSeo !== 'dynamic') return false;
        try { return JSON.parse(script.textContent ?? '{}')['@type'] === 'Place'; }
        catch { return false; }
      }),
    canonical,
    { timeout: 15000 },
  );
  const meta = await metaOf(page);
  check('station detail hydrates its own canonical and structured data',
    meta.canonical === canonical
      && meta.robots !== 'noindex,follow'
      && meta.jsonLd.some(item => item['@type'] === 'Place'),
    `${meta.canonical} · ${JSON.stringify(meta.jsonLd.map(item => item['@type']))}`);
  const text = await page.locator('body').innerText();
  check('station detail keeps source provenance visible', text.includes(`Source: ${station.sourceName}`),
    text.slice(0, 140).replace(/\n/g, ' '));
  await page.close();
}

try {
  await checkStaticAssets();
  await checkCuratedSearch();
  await checkArbitraryQuery();
  await checkHubsAndHotels();
  await checkStationDetailSeo();
  await checkRouteLinks();
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll SEO/route checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
