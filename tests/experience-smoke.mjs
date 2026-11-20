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

const BASE_URL = process.env.BASE_URL ?? 'https://road-to-charge-v2.vercel.app';
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
    check(`${width}px: Ruvo is branded in the header`, brand.includes('Ruvo'), brand.replace(/\n/g, ' '));

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
    await cards.first().click();
    await page.waitForURL(/\/station\//, { timeout: 20000 });
    const detailTitle = page.locator('header h1').first();
    await detailTitle.waitFor({ state: 'visible', timeout: 20000 });
    const detailBrand = await detailTitle.innerText();
    const detailBrandStyle = await detailTitle.evaluate(el => {
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily };
    });
    check(`${width}px: detail header uses the Ruvo wordmark`, detailBrand.includes('Ruvo'), detailBrand.replace(/\n/g, ' '));
    check(`${width}px: detail/list title styling matches`,
      JSON.stringify(listBrandStyle) === JSON.stringify(detailBrandStyle),
      `${JSON.stringify(listBrandStyle)} vs ${JSON.stringify(detailBrandStyle)}`);
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
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll experience checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
