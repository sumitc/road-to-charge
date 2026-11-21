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

try {
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
    await detailTitle.waitFor({ state: 'visible', timeout: 20000 });
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
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
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
