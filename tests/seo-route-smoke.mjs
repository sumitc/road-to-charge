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

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(ok) {
          ok({ coords: { latitude: 17.42, longitude: 78.34 } });
        },
      },
    });
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
  await page.route('**/api/stations**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
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

async function checkStaticAssets() {
  const robots = await fetch(`${BASE_URL}/robots.txt`).then(r => r.text());
  check('robots.txt advertises the sitemap', /Sitemap:\s*https:\/\/ampo\.vercel\.app\/sitemap\.xml/.test(robots));
  check('robots.txt allows answer-engine crawlers',
    ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot'].every(bot =>
      new RegExp(`User-agent: ${bot}[\\s\\S]*?Allow: /`).test(robots)));

  const sitemap = await fetch(`${BASE_URL}/sitemap.xml`).then(r => r.text());
  const urlCount = (sitemap.match(/<url>/g) ?? []).length;
  check('sitemap includes all generated pages', urlCount === 237, `${urlCount} URLs`);
  check('sitemap XML-escapes canonical query URLs',
    sitemap.includes('https://ampo.vercel.app/?q=Delhi&amp;place=ChIJL_P_CXMEDTkRw0ZdG-0GVvw'));
  check('sitemap includes hotel detail pages', sitemap.includes('<loc>https://ampo.vercel.app/hotels/google-'));

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
      && fsHandleAt === 34
      && (config.routes ?? []).at(-1)?.src === '/(.*)'
      && (config.rewrites ?? []).length === 0
      && config.crons?.length === 2,
    `${queryRoutes.length} query routes, filesystem at ${fsHandleAt}`);
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
    () => document.querySelector('[role="tab"][data-state="active"]')?.textContent?.includes('Hotels'),
    null,
    { timeout: 15000 },
  );
  const hotelText = await hotels.page.locator('body').innerText();
  check('published Hotels tab uses the real Google Places index',
    hotelText.includes(`${hotelIndex.hotels.length} hotels`)
      || hotelText.includes('Google Places index'),
    hotelText.slice(0, 120).replace(/\n/g, ' '));
  const hotelsMeta = await metaOf(hotels.page);
  check('hotel index has its own canonical',
    hotelsMeta.canonical === 'https://ampo.vercel.app/hotels/', hotelsMeta.canonical);
  await hotels.page.close();

  const detail = await newPage();
  await detail.page.goto(`${BASE_URL}/hotels/${hotel.id}/`, { waitUntil: 'domcontentloaded' });
  await detail.page.waitForFunction(
    () => document.title.includes('Hotels with EV charging'),
    null,
    { timeout: 15000 },
  );
  const detailText = await detail.page.locator('body').innerText();
  check('hotel detail keeps honest nearby-charger provenance',
    detailText.includes('nearby public charger') || detailText.includes('nearby charger')
      ? !/on-site EV charging/i.test(detailText)
      : /Google Maps source/.test(detailText),
    detailText.slice(0, 140).replace(/\n/g, ' '));
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

try {
  await checkStaticAssets();
  await checkCuratedSearch();
  await checkArbitraryQuery();
  await checkHubsAndHotels();
  await checkRouteLinks();
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll SEO/route checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
