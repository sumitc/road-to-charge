/**
 * Local-only regression checks for the "no results" UX and analytics signal.
 * External APIs are mocked so the counts are deterministic and offline.
 *
 *   npm run build
 *   npm run preview -- --port 4173 --host 127.0.0.1
 *   BASE_URL=http://127.0.0.1:4173 npm run test:empty
 */
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
        : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(suggestions) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/router.project-osrm.org/table/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ distances: [] }),
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
  await page.waitForFunction(() => document.body.innerText.includes('183 of 183 stays'), null, { timeout: 30000 });

  check('EV evidence and provider filters are gone',
    (await page.locator('select[aria-label="EV signal"]').count()) === 0
      && (await page.locator('select[aria-label="Charging provider"]').count()) === 0);

  const initialBody = await page.locator('body').innerText();
  check('EV index badge is gone but honest per-hotel evidence tags remain',
    !initialBody.includes('EV INDEX') && initialBody.includes('Charger nearby'));
  const evidenceTag = page.getByText('Charger nearby', { exact: true }).first();
  const evidenceClass = await evidenceTag.getAttribute('class');
  check('evidence tag is a small search-results-style pill',
    Boolean(evidenceClass?.includes('rounded-full') && evidenceClass.includes('text-[10px]')),
    evidenceClass ?? '');

  const radiusSelect = page.getByLabel('Search radius in kilometres');
  check('hotel search has the same distance control as stations',
    (await radiusSelect.inputValue()) === 'all'
      && (await radiusSelect.locator('option[value="5"]').count()) === 1
      && (await radiusSelect.locator('option[value="25"]').count()) === 1);
  check('hotel search adds a Google rating filter',
    (await page.getByLabel('Minimum Google rating').count()) === 1);
  check('hotel cards show distance from the active origin',
    (await page.locator('span[title="Straight-line distance"]').count()) > 0);

  const connectorButton = page.getByRole('button', { name: /All connectors/ });
  check('connector filter replaces the provider box', (await connectorButton.count()) > 0);
  await connectorButton.click();
  await page.getByRole('button', { name: /Super-fast · CCS/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => {
    const match = document.body.innerText.match(/(\d+) of 183 stays/);
    return match && Number(match[1]) > 0 && Number(match[1]) < 183;
  }, null, { timeout: 15000 });
  const ccsCount = Number(((await page.locator('body').innerText()).match(/(\d+) of 183 stays/) ?? [])[1] ?? 183);
  check('connector filter narrows hotels using real Google connector data',
    ccsCount > 0 && ccsCount < 183, `${ccsCount} stays`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('183 of 183 stays'), null, { timeout: 15000 });

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
    await page.waitForFunction(() => {
      const match = document.body.innerText.match(/(\d+) of 183 stays/);
      return match && Number(match[1]) > 0 && Number(match[1]) < 183;
    }, null, { timeout: 15000 });
    const pickedText = await page.locator('body').innerText();
    const pickedCount = Number((pickedText.match(/(\d+) of 183 stays/) ?? [])[1] ?? 183);
    check('picking a hotel-area suggestion narrows stays',
      pickedCount > 0 && pickedCount < 183, `${pickedCount} stays`);
  }

  await input.fill('Jaipur');
  await page.waitForFunction(() => document.body.innerText.includes('of 183 stays'), null, { timeout: 15000 });
  const jaipurText = await page.locator('body').innerText();
  const jaipurCount = Number((jaipurText.match(/(\d+) of 183 stays/) ?? [])[1] ?? 0);
  check('hotel list is queryable by city', jaipurCount > 0 && jaipurCount < 183, `${jaipurCount} stays`);

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
  await checkSearch();
  await checkRoute();
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll zero-result checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
