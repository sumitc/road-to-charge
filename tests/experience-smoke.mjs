/**
 * Mobile experience regression checks.
 *
 * Run: npm run test:experience
 * Override target/browser: BASE_URL=http://localhost:5173 CHROME_PATH=... npm run test:experience
 *
 * These are intentionally small DOM/layout assertions rather than snapshots:
 * they catch "experience breaks" like a long search query reflowing the
 * filter row, horizontal overflow, unstable state after refresh, and missing
 * photo-source disclosure on result cards.
 */
import { chromium } from 'playwright-core';

const BASE_URL = process.env.BASE_URL ?? 'https://ampo.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

let failures = 0;
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fabMetrics(page, width, height) {
  const fab = page.getByRole('button', { name: 'Add a charging station' });
  const box = await fab.boundingBox();
  return {
    present: Boolean(box),
    inViewport: Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1),
    box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
  };
}

async function searchCardMetrics(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Search for charging stations by area or city"]');
    const card = input?.closest('.rounded-2xl');
    const controls = document.querySelector('[data-testid="search-controls"]');
    const rect = el => el ? {
      y: Math.round(el.getBoundingClientRect().y),
      h: Math.round(el.getBoundingClientRect().height),
    } : null;
    return {
      controls: rect(controls),
      card: rect(card),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardOverflow: card ? card.scrollWidth - card.clientWidth : 0,
    };
  });
}

// Radix keeps `aria-hidden` on the app root until the dialog's exit animation
// finishes. Closing overlays back-to-back without waiting makes the main UI
// unavailable to role-based queries, so wait for the cleanup to complete.
async function closeOverlay(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    document.querySelectorAll('[role="dialog"][data-state="open"]').length === 0
      && document.querySelectorAll('[data-aria-hidden="true"]').length === 0,
  null, { timeout: 5000 }).catch(() => {});
}

// Overlay interactions scroll the long list to the footer and briefly set
// `aria-hidden` on the app root, so run them on a fresh page after the layout
// checks instead of polluting those measurements.
async function checkOverlays(width) {
  const page = await browser.newPage({
    viewport: { width, height: 844 },
    isMobile: width < 500,
    deviceScaleFactor: 1,
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Search for charging stations by area or city').waitFor({ timeout: 20000 });
  const cards = page.locator('button[aria-label^="View details for"]');
  await cards.first().waitFor({ timeout: 25000 });

  const cardText = await cards.evaluateAll(els => els.slice(0, 20).map(el => el.innerText));
  check(`${width}px: list cards do not repeat "Google Places" as provider`,
    cardText.length > 0 && cardText.every(text => !/Google Places/.test(text)),
    `${cardText.length} cards`);
  const liveDots = await page.locator('span[title="Available — live status"] .animate-ping').count();
  check(`${width}px: available stations show a radiating live dot`, liveDots > 0, `${liveDots} dots`);

  const improveButton = page.locator('footer').first().getByRole('button', { name: /Help us Improve/ });
  check(`${width}px: footer reads "Help us Improve!" instead of repeating Feedback`,
    (await improveButton.count()) === 1);
  await improveButton.click();
  const feedbackDialog = page.getByRole('dialog');
  await feedbackDialog.waitFor({ state: 'visible', timeout: 5000 });
  const dialogText = await feedbackDialog.innerText();
  check(`${width}px: feedback form needs no login`, /No login needed/.test(dialogText));
  check(`${width}px: feedback form accepts a message and optional email`,
    await feedbackDialog.getByLabel('Your feedback').isVisible()
    && await feedbackDialog.getByLabel('Your email (optional)').isVisible());
  await closeOverlay(page);

  await page.getByRole('button', { name: 'Add a charging station' }).click();
  const addSheet = page.getByRole('dialog');
  await addSheet.waitFor({ state: 'visible', timeout: 5000 });
  check(`${width}px: add-station popup includes the footer`,
    /2026.*Fibuladreams Pvt Ltd\./.test(await addSheet.innerText()));
  await closeOverlay(page);

  // "Review" from a list card must land on the detail page's review section.
  const firstCard = cards.first().locator('..');
  await firstCard.getByRole('button', { name: /Review/ }).click();
  await page.locator('#reviews').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => {
    const r = document.getElementById('reviews')?.getBoundingClientRect();
    return Boolean(r && r.top < window.innerHeight && r.bottom > 0);
  }, null, { timeout: 6000 }).catch(() => {});
  check(`${width}px: Review opens the detail page at the review section`,
    new URL(page.url()).hash === '#reviews'
      && await page.locator('#reviews').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      }),
    page.url().split('/').pop());

  // Detail page feedback sheet (target the FAB; the footer button now differs).
  await page.locator('button.fixed.right-4').click();
  const stationFeedbackSheet = page.getByRole('dialog');
  await stationFeedbackSheet.waitFor({ state: 'visible', timeout: 5000 });
  check(`${width}px: station feedback popup includes the footer`,
    /2026.*Fibuladreams Pvt Ltd\./.test(await stationFeedbackSheet.innerText()));

  // A submitted report must scroll back to the same review section and be
  // visibly attributed to the user (other rows are community reports). Done
  // in the same sheet session — Escape does not reliably close bottom sheets.
  if (width === 390) {
    await stationFeedbackSheet.getByRole('button', { name: 'Working', exact: true }).click();
    await stationFeedbackSheet.locator('textarea').fill('Experience smoke test — live status check');
    await stationFeedbackSheet.getByRole('button', { name: 'Submit feedback' }).click();
    await page.waitForFunction(() => {
      const r = document.getElementById('reviews')?.getBoundingClientRect();
      return Boolean(r && r.top < window.innerHeight && r.bottom > 0);
    }, null, { timeout: 8000 }).catch(() => {});
    check('submitting feedback anchors back to the review section',
      await page.locator('#reviews').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      }));
    await page.locator('#reviews').getByText('Your report').first()
      .waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    check('submitted feedback is source-marked as Your report',
      (await page.locator('#reviews').getByText('Your report').count()) > 0);
  }

  await closeOverlay(page);
  await page.close();

  // Bottom sheets can leave an overlay intercepting pointer events, so verify
  // the home link from a fresh detail page instead of the sheet session above.
  const homePage = await browser.newPage({
    viewport: { width, height: 844 },
    isMobile: width < 500,
    deviceScaleFactor: 1,
  });
  await homePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const homeCards = homePage.locator('button[aria-label^="View details for"]');
  await homeCards.first().waitFor({ timeout: 25000 });
  await homeCards.first().click();
  await homePage.waitForURL(/\/station\//, { timeout: 20000 });
  const homeLink = homePage.locator('header h1 a[aria-label="Ampo home"]').first();
  await homeLink.waitFor({ state: 'visible', timeout: 5000 });
  await homeLink.click();
  await homePage.waitForFunction(() => window.location.pathname === '/', null, { timeout: 10000 }).catch(() => {});
  check(`${width}px: Ampo title navigates to the root page`,
    new URL(homePage.url()).pathname === '/', homePage.url());
  await homePage.close();
}

// Google place picker: options must drop from the search input, spelling
// mistakes must be corrected, and the chosen place must be shareable.
async function checkPlacePicker() {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('Search for charging stations by area or city');
  await input.waitFor({ timeout: 20000 });
  const statusText = await input.evaluate(el => el.closest('.rounded-2xl')?.innerText ?? '');
  check('nearby mode states that results are near you',
    /Showing results near you/.test(statusText), statusText.replace(/\n/g, ' | '));

  // Default footprint should resemble a map viewport, not a 10 km sweep, and
  // a tighter 3 km option must be available for Google-Maps-like browsing.
  const radiusSelect = page.getByLabel('Search radius in kilometres');
  check('default search radius is 5 km',
    (await radiusSelect.inputValue().catch(() => '')) === '5',
    `value=${await radiusSelect.inputValue().catch(() => 'missing')}`);
  check('3 km radius option is available',
    await radiusSelect.locator('option[value="3"]').count() === 1);

  await input.fill('aparna sarovr');
  const listbox = page.getByRole('listbox', { name: 'Matching places' });
  await listbox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check('typing opens the Google place dropdown', await listbox.isVisible().catch(() => false));
  if (await listbox.isVisible().catch(() => false)) {
    const inputBox = await input.boundingBox();
    const listBox = await listbox.boundingBox();
    check('place dropdown drops from the input edge',
      Boolean(inputBox && listBox)
      && Math.abs(inputBox.x - listBox.x) <= 2
      && Math.abs(inputBox.width - listBox.width) <= 2
      && listBox.y >= inputBox.y + inputBox.height - 2
      && listBox.y <= inputBox.y + inputBox.height + 10,
      `input=${JSON.stringify(inputBox)} dropdown=${JSON.stringify(listBox)}`);
  }
  const options = listbox.getByRole('option');
  const optionText = await options.allInnerTexts();
  check('autocomplete corrects the misspelled place name',
    optionText.some(text => /Aparna Sarovar/i.test(text)),
    optionText.slice(0, 2).join(' | '));
  if (optionText.length > 0) {
    await options.first().click();
    const cards = page.locator('button[aria-label^="View details for"]');
    await cards.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    check('chosen place is shareable in the URL',
      page.url().includes('q=') && page.url().includes('place='), page.url());
    const picked = await input.inputValue();
    check('chosen place replaces the typed misspelling',
      !/sarovr/i.test(picked) && picked.length > 0, picked);
    check('chosen place renders station cards', (await cards.count()) > 0);
    await page.getByRole('button', { name: 'Show Nearby' }).click();
    await page.waitForTimeout(800);
    check('Show Nearby clears the chosen place from the URL',
      !page.url().includes('q=') && !page.url().includes('place='), page.url());
  }

  await input.fill('nalagandla');
  await page.waitForTimeout(150); // let React observe the typed value
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const corrected = await input.inputValue();
  const correctedLower = corrected.toLowerCase();
  // Google may localise this locality as "Nallagandla" or "Nalagandla";
  // either way the typed all-lowercase query must become a chosen place.
  check('Enter auto-corrects a misspelled locality',
    corrected !== 'nalagandla'
    && (correctedLower.startsWith('nallagandla') || correctedLower.startsWith('nalagandla'))
    && page.url().includes('place='), corrected);
  await page.close();
}

// A search must centre distances on the exact Google place, not on the
// centroid of the 100 returned rows (which drifts toward dense suburbs and
// used to put far-away Kondapur stations at the top for "nalagandla").
async function checkSearchCentre() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.addInitScript(() => {
    localStorage.setItem('ampo_last_location', JSON.stringify({
      location: { lat: 17.4485, lng: 78.3908 }, timestamp: Date.now(),
    }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition(ok) { ok({ coords: { latitude: 17.4485, longitude: 78.3908 } }); } },
    });
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('Search for charging stations by area or city');
  await input.waitFor({ timeout: 20000 });

  const placeCentre = await page.evaluate(async () => {
    const res = await fetch('/api/stations?mode=search&q=nalagandla');
    await res.arrayBuffer();
    return res.headers.get('X-Ampo-Place-Center');
  });
  check('search API exposes the exact Google place centre', Boolean(placeCentre), placeCentre ?? 'none');

  const origins = [];
  const track = req => {
    if (req.url().includes('/api/stations?mode=distance')) {
      const u = new URL(req.url());
      origins.push(`${u.searchParams.get('lat')},${u.searchParams.get('lng')}`);
    }
  };
  page.on('request', track);
  // The distance request follows the search response, which can take several
  // seconds (Places + DB + coverage check). Wait for it instead of a fixed
  // sleep so a slow prod response cannot produce a false negative.
  const [lat, lng] = (placeCentre ?? '').split(',');
  const centredRequest = placeCentre
    ? page.waitForRequest(req => req.url().includes('/api/stations?mode=distance')
      && req.url().includes(`lat=${lat}`) && req.url().includes(`lng=${lng}`),
    { timeout: 20000 }).catch(() => null)
    : Promise.resolve(null);
  await input.fill('nalagandla');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  const matched = await centredRequest;
  page.off('request', track);

  check('search distances use the resolved place as their origin',
    Boolean(matched), `place=${placeCentre} origins=${origins.slice(-3).join(' | ')}`);
  await page.close();
}

// "Show Nearby" must return to the device's CURRENT location, not a snapshot
// captured at mount and not the searched area — even if a stale cache says
// something else.
async function checkShowNearbyUsesCurrentLocation() {
  const cached = { lat: 17.4485, lng: 78.3908 };
  const current = { lat: 17.42, lng: 78.42 };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.addInitScript(({ cached, current }) => {
    localStorage.setItem('ampo_last_location', JSON.stringify({ location: cached, timestamp: Date.now() }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition(ok) { ok({ coords: { latitude: current.lat, longitude: current.lng } }); } },
    });
  }, { cached, current });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('Search for charging stations by area or city');
  await input.waitFor({ timeout: 20000 });
  await input.fill('Kokapet');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForTimeout(2500);

  const currentRequest = page.waitForRequest(req => req.url().includes('/api/stations?mode=distance')
    && req.url().includes(`lat=${current.lat}`) && req.url().includes(`lng=${current.lng}`),
  { timeout: 20000 }).catch(() => null);
  await page.getByRole('button', { name: 'Show Nearby' }).click();
  const matched = await currentRequest;
  check('Show Nearby uses the device current location, not a cached snapshot',
    Boolean(matched), `current=${current.lat},${current.lng} cached=${cached.lat},${cached.lng}`);
  // The fresh-location refetch is awaited before the UI clears the URL, so
  // wait for the URL to settle instead of sampling it as soon as the request
  // is issued.
  await page.waitForURL(url => !url.search.includes('q=') && !url.search.includes('place='),
    { timeout: 10000 }).catch(() => {});
  check('Show Nearby clears the searched query',
    !page.url().includes('q=') && !page.url().includes('place='), page.url());
  await page.close();
}

// The Ampo wordmark and logo icon are home affordances: they must behave
// exactly like "Show Nearby" — re-read GPS/clear search/reload nearby rows.
async function checkHeaderHomeAffordances() {
  const cached = { lat: 17.4485, lng: 78.3908 };
  const current = { lat: 17.42, lng: 78.42 };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.addInitScript(({ cached, current }) => {
    localStorage.setItem('ampo_last_location', JSON.stringify({ location: cached, timestamp: Date.now() }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition(ok) { ok({ coords: { latitude: current.lat, longitude: current.lng } }); } },
    });
  }, { cached, current });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('Search for charging stations by area or city');
  await input.waitFor({ timeout: 20000 });

  const search = async () => {
    await input.fill('Kokapet');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForTimeout(2500);
  };
  const expectCurrent = async (label) => {
    const request = page.waitForRequest(req => req.url().includes('/api/stations?mode=distance')
      && req.url().includes(`lat=${current.lat}`) && req.url().includes(`lng=${current.lng}`),
    { timeout: 20000 }).catch(() => null);
    await page.getByRole('link', { name: label }).click();
    const matched = await request;
    check(`header ${label} returns to the current location`, Boolean(matched),
      `current=${current.lat},${current.lng} cached=${cached.lat},${cached.lng}`);
    check(`header ${label} clears the searched query`,
      !page.url().includes('q=') && !page.url().includes('place='), page.url());
  };

  await search();
  await expectCurrent('Ampo home');

  // The status line is text-only — no pin icon next to "Showing results…".
  const status = page.getByText('Showing results near you', { exact: true });
  await status.waitFor({ timeout: 10000 }).catch(() => {});
  check('nearby status line has no icon',
    !(await status.evaluate(el => Boolean(el.parentElement?.querySelector('svg')))));

  await search();
  await expectCurrent(/Ampo logo/);
  await page.close();
}

// A handful of BEE rows still carry broken font-glyph text. The UI must show a
// readable provider-based label instead of the mojibake. Mock the nearby API so
// this check does not depend on which rows a future catalog refresh contains.
async function checkGarbledNameFallback() {
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
  const garbled = 'K\u0102\u016C\u01C1\u017D\u017D\u011A\u0003Z\u011E\u015D\u0069\u011A\u0146\u011E\u0108\u011E';
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    station_name: garbled,
    address: `${garbled}, Hyderabad, Telangana`,
    provider: 'Joule',
    city: 'Hyderabad',
    state: 'Telangana',
    latitude: '17.42',
    longitude: '78.34',
    availability_status: 'unknown',
    connector_types: ['Type 2'],
  };
  await page.route('**/api/stations?mode=distance*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([row]),
  }));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const card = page.locator('button[aria-label^="View details for"]').first();
  await card.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const text = await card.innerText().catch(() => '');
  check('garbled station name falls back to a readable label',
    /charging station/i.test(text) && !/[\u0100-\u024F\u0370-\u03FF]/.test(text),
    text.replace(/\n/g, ' ').slice(0, 140));
  await page.close();
}

try {
  await checkPlacePicker();
  await checkSearchCentre();
  await checkShowNearbyUsesCurrentLocation();
  await checkHeaderHomeAffordances();
  await checkGarbledNameFallback();
  for (const width of [320, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      isMobile: width < 500,
      deviceScaleFactor: 1,
    });
    // Only JS exceptions and app-level console errors are experience breaks.
    // Third-party map/photo/routing resources can time out independently; those
    // are not UI regressions and would make this check flaky.
    const errors = [];
    const isNetworkNoise = text =>
      /Failed to load resource|ERR_TIMED_OUT|ERR_ABORTED|net::ERR_|Failed to fetch/.test(text);
    page.on('console', m => {
      if (m.type() === 'error' && !isNetworkNoise(m.text())) errors.push(m.text());
    });
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const brand = await page.locator('header h1').innerText();
    check(`${width}px: Ampo is branded in the header`, brand.includes('Ampo'), brand.replace(/\n/g, ' '));

    const footer = page.locator('footer').first();
    const footerText = await footer.innerText();
    check(`${width}px: footer shows the copyright clause`,
      /2026.*Fibuladreams Pvt Ltd\. All rights reserved\./.test(footerText),
      footerText.replace(/\n/g, ' '));
    check(`${width}px: footer feedback control is an in-app button (no GitHub login)`,
      (await footer.getByRole('button', { name: /Help us Improve/ }).count()) === 1);
    const githubLink = footer.getByRole('link', { name: /Star on GitHub/ });
    check(`${width}px: footer links to the open-source repo`,
      (await githubLink.count()) === 1 &&
      (await githubLink.first().getAttribute('href')) === 'https://github.com/sumitc/road-to-charge',
      await githubLink.first().getAttribute('href'));

    const input = page.getByLabel('Search for charging stations by area or city');
    await input.waitFor({ state: 'visible', timeout: 20000 });

    const before = await searchCardMetrics(page);
    const longQuery = 'Indiranagar Bangalore Koramangala 100 Feet Road extremely long query';
    await input.fill(longQuery);
    await page.waitForTimeout(200);
    const afterTyping = await searchCardMetrics(page);
    check(
      `${width}px: typing a long query does not reflow the filter row`,
      afterTyping.controls?.h === before.controls?.h && afterTyping.controls?.y === before.controls?.y,
      `before=${JSON.stringify(before.controls)} after=${JSON.stringify(afterTyping.controls)}`,
    );

    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForTimeout(1500);
    const afterSearch = await searchCardMetrics(page);
    check(
      `${width}px: search results label does not reflow the filter row`,
      afterSearch.controls?.h === before.controls?.h && afterSearch.controls?.y === before.controls?.y,
      `before=${JSON.stringify(before.controls)} after=${JSON.stringify(afterSearch.controls)}`,
    );
    check(`${width}px: no horizontal overflow`, afterSearch.docOverflow <= 0 && afterSearch.cardOverflow <= 0,
      `doc=${afterSearch.docOverflow} card=${afterSearch.cardOverflow}`);

    const fabAfterSearch = await fabMetrics(page, width, 844);
    check(`${width}px: add button stays on screen after search`,
      fabAfterSearch.present && fabAfterSearch.inViewport,
      JSON.stringify(fabAfterSearch.box));

    // Use a query that reliably returns rows for the downstream card checks.
    await input.fill('Kokapet');
    await page.getByRole('button', { name: 'Search' }).click();
    const cards = page.locator('button[aria-label^="View details for"]');
    await cards.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    check(`${width}px: search results render station cards`, (await cards.count()) > 0);
    if ((await cards.count()) > 0) {
      const distanceTitle = await page.locator('span[title$="distance"]').first().getAttribute('title');
      check(`${width}px: distance badge states its measurement type`,
        distanceTitle === 'Driving distance' || distanceTitle === 'Straight-line distance',
        String(distanceTitle));

      const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
      await page.getByRole('button', { name: 'Directions' }).first().click();
      const popup = await popupPromise;
      if (popup) {
        const url = popup.url();
        check(`${width}px: directions use the same origin as the displayed distance`,
          url.includes('origin='), url.slice(0, 160));
        await popup.close();
      } else {
        check(`${width}px: directions open a map link`, false, 'no popup observed');
      }
    }

    const listBrandStyle = await page.locator('header h1').first().evaluate(el => {
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily };
    });
    const headerTheme = p => p.locator('header').first().evaluate(el => {
      const cs = getComputedStyle(el);
      return { image: cs.backgroundImage, color: cs.backgroundColor };
    });
    const listHeaderTheme = await headerTheme(page);
    await cards.first().click();
    await page.waitForURL(/\/station\//, { timeout: 20000 });
    const detailTitle = page.locator('header h1').first();
    // Wait for the detail header's own content: the list h1 can still be
    // attached briefly after the URL changes. A transient Radix overlay can
    // also leave the tree aria-hidden, so do not require visibility here.
    await page.waitForFunction(
      () => document.querySelector('header h1')?.textContent?.includes('Station details'),
      null,
      { timeout: 20000 },
    );
    await detailTitle.waitFor({ state: 'attached', timeout: 20000 });
    const detailBrand = await detailTitle.innerText();
    const detailBrandStyle = await detailTitle.evaluate(el => {
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily };
    });
    check(`${width}px: detail header uses the Ampo wordmark`, detailBrand.includes('Ampo'), detailBrand.replace(/\n/g, ' '));
    check(`${width}px: detail/list title styling matches`,
      JSON.stringify(listBrandStyle) === JSON.stringify(detailBrandStyle),
      `${JSON.stringify(listBrandStyle)} vs ${JSON.stringify(detailBrandStyle)}`);
    const detailHeaderTheme = await headerTheme(page);
    check(`${width}px: detail header theme matches the list header`,
      JSON.stringify(listHeaderTheme) === JSON.stringify(detailHeaderTheme),
      `${JSON.stringify(listHeaderTheme)} vs ${JSON.stringify(detailHeaderTheme)}`);
    const detailFooterText = await page.locator('footer').first().innerText();
    check(`${width}px: detail page has the same footer`,
      /2026.*Fibuladreams Pvt Ltd\. All rights reserved\./.test(detailFooterText),
      detailFooterText.replace(/\n/g, ' '));

    const updates = await page.evaluate(() => {
      const title = [...document.querySelectorAll('h2')]
        .find(el => el.textContent?.includes('Reviews & community updates'));
      const subtitle = title?.parentElement?.querySelector('span');
      const rect = el => el ? {
        y: Math.round(el.getBoundingClientRect().y),
        h: Math.round(el.getBoundingClientRect().height),
      } : null;
      return { title: rect(title), subtitle: rect(subtitle) };
    });
    check(`${width}px: reviews subtitle sits below the title`,
      Boolean(updates.title && updates.subtitle && updates.subtitle.y >= updates.title.y + updates.title.h - 1),
      JSON.stringify(updates));
    check(`${width}px: reviews title stays on one line`,
      Boolean(updates.title && updates.title.h <= 24), String(updates.title?.h));
    const reviewsText = await page.locator('#reviews').innerText();
    check(`${width}px: detail page shows explicit review details`,
      /Reviews/.test(reviewsText) && /Recent reviews|No reviews yet/.test(reviewsText),
      reviewsText.replace(/\n/g, ' ').slice(0, 120));
    const communityReviews = page.locator('[data-testid="community-reviews"]');
    const reviewRows = await communityReviews.locator('li').count();
    const reviewDetailLines = await communityReviews.locator('li p').count();
    check(`${width}px: every review shows its written details`,
      reviewRows === 0 || reviewDetailLines === reviewRows,
      `${reviewDetailLines}/${reviewRows}`);

    // Google reviews are fetched separately so the premium Places SKU is only
    // paid for on detail pages. Verify the block resolves and is attributed.
    const googleBlock = page.locator('[aria-label="Google Maps reviews"]');
    await googleBlock.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[aria-label="Google Maps reviews"]');
      return el && !/Loading Google reviews/.test(el.textContent || '');
    }, null, { timeout: 30000 }).catch(() => {});
    const googleText = await googleBlock.innerText();
    check(`${width}px: Google reviews are shown with attribution`,
      /Reviews from Google Maps/.test(googleText) && /Google Maps/.test(googleText),
      googleText.replace(/\n/g, ' ').slice(0, 120));

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByLabel('Search for charging stations by area or city').waitFor({ state: 'visible', timeout: 20000 });

    // Repeated refresh must not change the active tab, restore stale text, or
    // accumulate console errors.
    await input.fill('Kokapet');
    const states = [];
    for (let i = 0; i < 3; i++) {
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch {
        // A slow reload can detach the first navigation target; fall back to a
        // fresh navigation instead of retrying reload on a detached page.
        if (page.isClosed()) break;
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      await page.waitForTimeout(900);
      states.push(await page.evaluate(() => ({
        tab: document.querySelector('[role="tab"][data-state="active"]')?.textContent ?? '',
        search: document.querySelector('input[aria-label="Search for charging stations by area or city"]')?.value ?? '',
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      })));
    }
    check(`${width}px: refresh keeps nearby tab active`, states.every(s => s.tab.includes('Stations')),
      JSON.stringify(states.map(s => s.tab)));
    check(`${width}px: refresh clears the search box`, states.every(s => s.search === ''),
      JSON.stringify(states.map(s => s.search)));
    check(`${width}px: refresh causes no horizontal overflow`, states.every(s => s.overflow <= 0));
    const fabAfterRefresh = await fabMetrics(page, width, 844);
    check(`${width}px: add button stays on screen after refresh`,
      fabAfterRefresh.present && fabAfterRefresh.inViewport,
      JSON.stringify(fabAfterRefresh.box));
    check(`${width}px: no console/page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));

    await page.close();
    await checkOverlays(width);
  }

  // Location stability: a failed/denied GPS lookup must never replace a real
  // cached location with the Delhi fallback, and searching another city must
  // not overwrite the saved home location. Regression for "page loads with my
  // location, then randomly starts loading Delhi forever".
  const failGps = () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_ok, err) {
          setTimeout(() => err({ code: 2, message: 'Permission denied' }), 150);
        },
      },
    });
  };
  const staleHyderabad = {
    location: { lat: 17.4485, lng: 78.3908 },
    timestamp: Date.now() - 30 * 60 * 1000,
  };

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const locationPage = await context.newPage();
  await locationPage.addInitScript(cache => {
    localStorage.setItem('ampo_last_location', JSON.stringify(cache));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_ok, err) {
          setTimeout(() => err({ code: 2, message: 'Permission denied' }), 150);
        },
      },
    });
  }, staleHyderabad);
  await locationPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await locationPage.waitForTimeout(4000); // stale cache triggers a background GPS refetch
  const readCache = p => p.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ampo_last_location') ?? 'null'); } catch { return null; }
  });
  let cachedLocation = await readCache(locationPage);
  check('failed GPS keeps the real cached location',
    Math.abs((cachedLocation?.location?.lat ?? 0) - 17.4485) < 0.001,
    JSON.stringify(cachedLocation?.location ?? null));
  const nearbyNames = await locationPage.locator('button[aria-label^="View details for"]')
    .evaluateAll(els => els.slice(0, 5).map(el => el.getAttribute('aria-label') ?? ''));
  check('station list does not drift to Delhi after GPS failure',
    nearbyNames.length > 0 && !nearbyNames.some(name => /New Delhi|Delhi/i.test(name)),
    nearbyNames.slice(0, 2).join(' | '));

  await locationPage.getByLabel('Search for charging stations by area or city').fill('Kokapet');
  await locationPage.getByRole('button', { name: 'Search' }).click();
  await locationPage.waitForTimeout(2500);
  cachedLocation = await readCache(locationPage);
  check('searching another area does not overwrite the saved home location',
    Math.abs((cachedLocation?.location?.lat ?? 0) - 17.4485) < 0.001,
    JSON.stringify(cachedLocation?.location ?? null));

  // A search moves the active map centre to the searched area. "Show Nearby"
  // must re-query the user's real location. Compare the API request coords
  // rather than card order, which changes when road distances arrive.
  const nearbyRequests = [];
  const trackNearby = req => {
    if (req.url().includes('/api/stations?mode=distance')) nearbyRequests.push(req.url());
  };
  locationPage.on('request', trackNearby);
  await locationPage.getByRole('button', { name: 'Show Nearby' }).click();
  await locationPage.waitForTimeout(2500);
  locationPage.off('request', trackNearby);
  check('Show Nearby requeries the saved home location',
    nearbyRequests.some(u => u.includes('lat=17.4485') && u.includes('lng=78.3908')),
    nearbyRequests.slice(-2).join(' | '));
  const restoredNames = await locationPage.locator('button[aria-label^="View details for"]')
    .evaluateAll(els => els.slice(0, 5).map(el => el.getAttribute('aria-label') ?? ''));
  check('Show Nearby shows home-area stations again',
    restoredNames.length > 0 && !restoredNames.some(name => /Kokapet/i.test(name)),
    restoredNames.slice(0, 2).join(' | '));
  check('Show Nearby clears the shared query from the URL',
    !locationPage.url().includes('q='), locationPage.url());
  check('Show Nearby clears the search input',
    (await locationPage.getByLabel('Search for charging stations by area or city').inputValue()) === '');

  // First-time visitor (no cache) with failing GPS: the fallback is fine to
  // display, but must not be written to storage and reused on every reload.
  const firstVisitContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const firstVisit = await firstVisitContext.newPage();
  await firstVisit.addInitScript(failGps);
  await firstVisit.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await firstVisit.waitForTimeout(3000);
  check('Delhi fallback is not persisted for a first-time visitor',
    (await readCache(firstVisit)) === null, JSON.stringify(await readCache(firstVisit)));
  await firstVisitContext.close();
  await context.close();

  // The cards must stay ordered by the distance the user actually sees. The
  // list first renders straight-line estimates, then OSRM road distances
  // arrive — without re-sorting, a 2.1 km card could sit above a 1.9 km card.
  const orderContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const orderPage = await orderContext.newPage();
  await orderPage.addInitScript(() => {
    const here = { lat: 17.4485, lng: 78.3908 };
    localStorage.setItem('ampo_last_location', JSON.stringify({ location: here, timestamp: Date.now() }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(ok) {
          ok({ coords: { latitude: here.lat, longitude: here.lng } });
        },
      },
    });
  });
  await orderPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await orderPage.locator('button[aria-label^="View details for"]').first().waitFor({ timeout: 25000 });
  await orderPage.waitForFunction(() => {
    const badges = [...document.querySelectorAll('span[title$="distance"]')];
    return badges.length >= 5 && badges.every(b => b.getAttribute('title') === 'Driving distance');
  }, null, { timeout: 20000 }).catch(() => {});
  const distances = await orderPage.evaluate(() =>
    [...document.querySelectorAll('span[title$="distance"]')]
      .map(el => parseFloat((el.textContent ?? '').replace('~', '')))
      .filter(Number.isFinite));
  const inversions = distances.reduce((n, v, i) => n + (i > 0 && v < distances[i - 1] ? 1 : 0), 0);
  check('card order matches the displayed road distances',
    distances.length >= 5 && inversions === 0,
    `${distances.length} cards, ${inversions} inversions: ${distances.slice(0, 12).join(', ')}`);
  await orderContext.close();
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll experience checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
