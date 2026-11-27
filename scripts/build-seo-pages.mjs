#!/usr/bin/env node
/**
 * Build static, crawler-visible shells for Ampo's curated SEO pages.
 *
 * No serverless functions, no network calls, no DB writes. The registry is
 * src/data/seoPages.json; hotel pages come from the local Google Places index;
 * quality-gated station pages come from the manual stations-seo snapshot.
 *
 *   node scripts/build-seo-pages.mjs              # write dev shells into public/
 *   node scripts/build-seo-pages.mjs --dist       # write prod shells into dist/
 *   node scripts/build-seo-pages.mjs --validate   # source/registry checks only
 *
 * `npm run build` runs this script as prebuild (public/) and postbuild (dist/).
 * The dist pass swaps /src/main.tsx for the hashed Vite asset tags so the React
 * app takes over cleanly after crawlers see the static content.
 *
 * Routing note: these rules are emitted as low-level `routes` for vercel.json,
 * NOT `rewrites`. Vercel evaluates the filesystem before rewrite rules, so a
 * rewrite on `/` loses to the existing /index.html and the curated shell is
 * never served. `handle: filesystem` must stay AFTER the query rules.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'src/data/seoPages.json');
const HOTELS_PATH = path.join(ROOT, 'src/data/hotels-ev.index.generated.json');
const STATIONS_PATH = path.join(ROOT, 'src/data/stations-seo.generated.json');
const SITE = 'https://ampo.vercel.app';
const DIST_INDEX = path.join(ROOT, 'dist/index.html');
const ROUTES_OUT = path.join(os.tmpdir(), 'ampo-seo-vercel-routes.json');

const args = new Set(process.argv.slice(2));
const validateOnly = args.has('--validate');
const distMode = args.has('--dist');
const OUT_ROOT = distMode ? path.join(ROOT, 'dist') : path.join(ROOT, 'public');

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const abs = target => `${SITE}${target.startsWith('/') ? target : `/${target}`}`;

/** Proximity is never enough for an on-site EV claim in crawler-facing pages. */
const hasOnSiteEvidence = hotel => Boolean(
  (hotel.evSignal === 'both'
    || hotel.evSignal === 'on_site_google_place'
    || hotel.evSignal === 'on_site_official_source')
  && hotel.onSiteEvidence
  && hotel.onSiteEvidenceSource?.url
);

function queryHref(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return suffix ? `/?${suffix}` : '/';
}

const searchUrl = page => queryHref({ q: page.q, place: page.placeId });
const routeUrl = page => queryHref({ from: page.from, to: page.to });

function readAssetTags() {
  if (!distMode) {
    return { css: '', js: '<script type="module" src="/src/main.tsx"></script>' };
  }
  return fs.readFile(DIST_INDEX, 'utf8').then(html => {
    const matches = html.match(/<(?:script|link)\b[^>]*\b(?:src|href)="\/assets\/[^"]+"[^>]*>/g) ?? [];
    if (!matches.some(tag => tag.includes('script'))) {
      throw new Error('Could not find a built /assets/*.js script tag in dist/index.html');
    }
    return {
      css: matches.filter(tag => tag.startsWith('<link')).join('\n    '),
      // The regex stops at the opening ">" so add the required closing tag.
      js: matches.filter(tag => tag.startsWith('<script'))
        .map(tag => tag.endsWith('</script>') ? tag : `${tag}</script>`)
        .join('\n    '),
    };
  });
}

function shell({
  title,
  description,
  canonical,
  h1,
  intro,
  bullets = [],
  links = [],
  queryMap = [],
  photo = null,
  jsonLd,
  assets,
}) {
  const canonicalUrl = abs(canonical);
  const ogImage = `${SITE}/og-image.png?v=1`;
  const bulletHtml = bullets.length
    ? `<ul>${bullets.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '';
  const linkHtml = links.length
    ? `<p class="ampo-links">${links.map(link =>
        `<a href="${esc(link.href)}">${esc(link.label)}</a>`
      ).join('<span aria-hidden="true"> · </span>')}</p>`
    : '';
  const queryMapHtml = queryMap.length
    ? `<section class="ampo-query-map" style="margin-top:22px;padding:16px;background:#f0f9ff;border-radius:14px;font-size:14px;color:#334155"><h2 style="font-size:17px;margin:0 0 10px;color:#0f172a">Explore EV charging</h2>${queryMap.map(group =>
        `<div style="margin-top:6px"><strong style="color:#0f172a">${esc(group.label)}:</strong> ${group.links.map(link =>
          `<a href="${esc(link.href)}" style="color:#0284c7;text-decoration:underline">${esc(link.label)}</a>`
        ).join('<span aria-hidden="true"> · </span>')}</div>`
      ).join('')}</section>`
    : '';
  const json = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0ea5e9" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="author" content="Ampo" />
    <link rel="canonical" href="${esc(canonicalUrl)}" />
    <meta property="og:site_name" content="Ampo" />
    <meta property="og:locale" content="en_IN" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(canonicalUrl)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Ampo - EV charging near you" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${esc(canonicalUrl)}" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(ogImage)}" />
    <script type="application/ld+json" data-ampo-seo="static">${json}</script>
    <link rel="icon" type="image/png" sizes="32x32" href="/ampo-favicon-32.png?v=4" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4" />
    <link rel="manifest" href="/manifest.webmanifest?v=4" />
    ${assets.css}
    <style>
      .ampo-shell{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;max-width:760px;margin:0 auto;padding:24px 20px 56px;line-height:1.6}
      .ampo-brand{font-size:24px;font-weight:800;color:#0284c7;letter-spacing:-.5px}
      .ampo-brand span{font-size:14px;font-weight:500;color:#64748b;margin-left:10px}
      .ampo-shell h1{font-size:30px;line-height:1.2;margin:28px 0 14px}
      .ampo-shell p{font-size:16px;color:#334155}
      .ampo-shell ul{padding-left:20px;color:#475569}
      .ampo-links a{color:#0284c7;text-decoration:underline}
      .ampo-note{margin-top:24px!important;font-size:13px!important;color:#64748b!important}
      .ampo-photo{max-width:100%;height:auto;border-radius:16px;margin:16px 0}
    </style>
  </head>
  <body>
    <div id="root">
      <div class="ampo-shell">
        <div class="ampo-brand">Ampo <span>EV station finder</span></div>
        <main>
          ${photo ? `<img class="ampo-photo" src="${esc(photo.src)}" alt="${esc(photo.alt)}" width="640" height="360" />\n          ` : ''}<h1>${esc(h1)}</h1>
          <p>${esc(intro)}</p>
          ${bulletHtml}
          ${linkHtml}
          ${queryMapHtml ? `${queryMapHtml}\n          ` : ''}<p class="ampo-note">Ampo uses real public charging-station data from BEE, OpenStreetMap and Google Places. Live results load when JavaScript is enabled.</p>
        </main>
      </div>
    </div>
    <noscript>
      <div style="max-width:720px;margin:40px auto;font-family:sans-serif;color:#0f172a">
        <h1>${esc(h1)}</h1><p>${esc(intro)}</p>
      </div>
    </noscript>
    ${assets.js}
  </body>
</html>
`;
}

function websiteJsonLd() {
  return { '@type': 'WebSite', name: 'Ampo', url: SITE };
}

function breadcrumbJsonLd(name, url) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ampo', item: SITE },
      { '@type': 'ListItem', position: 2, name, item: abs(url) },
    ],
  };
}

function searchJsonLd(page, canonical) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: page.title,
    description: page.description,
    url: abs(canonical),
    about: {
      '@type': 'Place',
      name: page.q,
      ...(page.state ? { address: { '@type': 'PostalAddress', addressRegion: page.state } } : {}),
    },
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(page.h1, canonical),
  };
}

function routeJsonLd(page, canonical) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url: abs(canonical),
    about: [
      { '@type': 'Place', name: page.from },
      { '@type': 'Place', name: page.to },
    ],
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(page.h1, canonical),
  };
}

function hubJsonLd(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url: abs(page.path),
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(page.h1, page.path),
  };
}

function hotelJsonLd(hotel, canonical) {
  const photoUrl = hotel.photo?.localPath
    ? abs(hotel.photo.localPath)
    : hotel.photo?.sourceUrl;
  const nearest = hotel.ev?.nearestCharger;
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: hotel.name,
    description: `${hotel.name} in ${[hotel.city, hotel.state].filter(Boolean).join(', ')}. ${hotel.ev?.label ?? ''}`.trim(),
    url: abs(canonical),
    address: { '@type': 'PostalAddress', streetAddress: hotel.formattedAddress || hotel.area, addressLocality: hotel.city, addressRegion: hotel.state, addressCountry: 'IN' },
    geo: { '@type': 'GeoCoordinates', latitude: hotel.location.lat, longitude: hotel.location.lng },
    ...(photoUrl ? { image: photoUrl } : {}),
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'EV evidence',
        value: hasOnSiteEvidence(hotel)
          ? `EV on site, confirmed by ${hotel.onSiteEvidenceSource.label}`
          : 'Public charger nearby (not an on-site claim)',
      },
      ...(nearest ? [{ '@type': 'PropertyValue', name: 'Nearest public charger', value: `${nearest.provider} · ${nearest.name} · ${(nearest.distanceMeters / 1000).toFixed(2)} km` }] : []),
    ],
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(hotel.name, canonical),
  };
}

function hotelIndexJsonLd(hotels) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Hotels with EV charging in India | Ampo',
    description: 'Curated hotels near real public EV chargers in popular Indian tourist destinations.',
    url: abs('/hotels/'),
    isPartOf: websiteJsonLd(),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: hotels.length,
      itemListElement: hotels.slice(0, 100).map((hotel, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: hotel.name,
        url: abs(`/hotels/${hotel.id}/`),
      })),
    },
  };
}

function hotelH1(hotel) {
  return `${hotel.name} — ${hasOnSiteEvidence(hotel) ? 'hotel with EV charging' : 'EV charging nearby'}`;
}

function hotelIntro(hotel) {
  const place = [hotel.city, hotel.state].filter(Boolean).join(', ');
  const nearest = hotel.ev?.nearestCharger;
  const charger = nearest
    ? ` The nearest verified public charger is ${nearest.provider} at ${nearest.name}, about ${(nearest.distanceMeters / 1000).toFixed(2)} km away.`
    : '';
  if (hasOnSiteEvidence(hotel)) {
    return `${hotel.name} is in ${place || hotel.area}. On-site EV charging is confirmed by ${hotel.onSiteEvidenceSource.label}: “${hotel.onSiteEvidenceSource.quote}”${charger}`;
  }
  return `${hotel.name} is in ${place || hotel.area}.${charger} EV charging nearby is not a claim that the property itself provides a charger.`;
}

function hotelBullets(hotel) {
  const nearest = hotel.ev?.nearestCharger;
  return [
    ...(hasOnSiteEvidence(hotel)
      ? [`On-site charging source: ${hotel.onSiteEvidenceSource.label} · ${hotel.onSiteEvidenceSource.url}`]
      : []),
    `Google Places reports ${hotel.ev?.chargerCountWithinRadius ?? 0} public charging place(s) within ${(hotel.ev?.radiusMeters ?? 2500) / 1000} km — not an on-site claim`,
    nearest ? `Nearest charger: ${nearest.provider} · ${(nearest.distanceMeters / 1000).toFixed(2)} km` : 'No nearest charger recorded',
    `Providers seen nearby: ${(hotel.ev?.providers ?? []).join(', ') || 'unlisted network'}`,
    `Source: ${hotel.source} · Retrieved ${String(hotel.provenance?.retrievedAt ?? '').slice(0, 10)}`,
  ];
}

function hotelLinks(hotel, canonical) {
  const links = [
    { href: '/hotels/', label: 'All EV hotels' },
    { href: `/?q=${encodeURIComponent(hotel.city || hotel.area)}`, label: 'Chargers in this city' },
    { href: `${canonical}#contribute`, label: 'Contribute a missing charger' },
  ];
  if (hasOnSiteEvidence(hotel)) {
    links.push({ href: hotel.onSiteEvidenceSource.url, label: `${hotel.onSiteEvidenceSource.label} charging evidence` });
  }
  if (hotel.tripadvisorUrl) links.push({ href: hotel.tripadvisorUrl, label: 'Tripadvisor listing' });
  if (hotel.sourceUrl) links.push({ href: hotel.sourceUrl, label: 'Google Maps source' });
  return links;
}

const clip = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

function hubLink(registry, slug, label) {
  const page = registry.hubPages.find(item => item.slug === slug);
  return page ? { href: page.path, label: label || page.h1 } : null;
}

function stationPhotoUrl(station, width = 640) {
  return station.photoRef
    ? abs(`/api/place-photo?ref=${encodeURIComponent(station.photoRef)}&width=${width}`)
    : null;
}

function stationAreaLink(station, registry) {
  const text = [station.city, station.district, station.name, station.address]
    .filter(Boolean).join(' ').toLowerCase();
  const match = [...registry.searchPages]
    .sort((a, b) => b.q.length - a.q.length)
    .find(page => text.includes(page.q.toLowerCase()));
  return match
    ? { href: searchUrl(match), label: `EV chargers in ${match.q}` }
    : hubLink(registry, 'near-me', 'Find EV chargers near you');
}

function stationQueryMap(station, registry) {
  const connectorHubs = [
    { re: /ccs\s*2|ccs2|\bccs\b/i, slug: 'ccs2-charging', label: 'CCS2 charging stations' },
    { re: /bharat|is\s*17077/i, slug: 'bharat-ac-charging', label: 'Bharat AC charging stations' },
    { re: /type\s*2/i, slug: 'type-2-charging', label: 'Type 2 charging stations' },
    { re: /chademo/i, slug: 'chademo-charging', label: 'CHAdeMO charging stations' },
  ];
  const providerHubs = [
    { re: /tata[\s.-]*power/i, slug: 'tata-power-charging', label: 'Tata Power EV charging' },
    { re: /jio[\s.-]*bp|reliance\s+bp|bp\s+pulse/i, slug: 'jio-bp-charging', label: 'Jio-bp Pulse EV charging' },
    { re: /bolt[\s.-]*earth/i, slug: 'bolt-earth-charging', label: 'Bolt.Earth EV charging' },
    { re: /ather/i, slug: 'ather-grid-charging', label: 'Ather Grid charging' },
    { re: /charge[\s.-]*zone/i, slug: 'chargezone-charging', label: 'ChargeZone EV charging' },
  ];
  const connectorText = (station.connectorTypes ?? []).join(' ');
  const connectors = connectorHubs
    .filter(item => item.re.test(connectorText))
    .slice(0, 2)
    .map(item => hubLink(registry, item.slug, item.label))
    .filter(Boolean);
  if (!connectors.length) {
    const fallback = hubLink(registry, 'near-me', 'EV chargers near you');
    if (fallback) connectors.push(fallback);
  }
  if (Number(station.maxPowerKw) >= 50) {
    const fast = hubLink(registry, 'fast-charging-near-me', 'Fast EV charging near me');
    if (fast) connectors.push(fast);
  }
  const provider = providerHubs
    .filter(item => item.re.test(station.provider ?? ''))
    .map(item => hubLink(registry, item.slug, item.label))
    .filter(Boolean)
    .slice(0, 1);
  if (!provider.length) {
    const fallback = hubLink(registry, 'near-me', 'Compare public chargers');
    if (fallback) provider.push(fallback);
  }
  const map = hubLink(registry, 'india-ev-charging-map', 'India EV charging map');
  const planner = hubLink(registry, 'ev-road-trip-planner', 'EV road trip planner');
  const hotels = hubLink(registry, 'hotels-with-ev-charging', 'Hotels with EV charging');
  return [
    { label: 'Area', links: [stationAreaLink(station, registry), ...(map ? [map] : [])].filter(Boolean) },
    { label: 'Connector', links: connectors },
    { label: 'Network', links: provider },
    { label: 'Plan', links: [planner, hotels].filter(Boolean) },
  ].filter(group => group.links.length > 0);
}

function stationH1(station) {
  const place = [station.city, station.state].filter(Boolean).join(', ');
  return `${station.name} — EV charging station${place ? ` in ${place}` : ''}`;
}

function stationIntro(station) {
  const place = [station.city, station.state].filter(Boolean).join(', ')
    || [station.district, station.state].filter(Boolean).join(', ')
    || 'India';
  return `Public EV charging station in ${place}. ${station.provider} · data from ${station.sourceName}. This is a point-in-time catalogue entry; open Ampo for live availability and driver reports.`;
}

function stationBullets(station) {
  const connectors = station.connectorTypes?.length ? station.connectorTypes.join(', ') : 'not listed';
  return [
    `Network: ${station.provider}`,
    `Connectors: ${connectors}`,
    ...(Number(station.maxPowerKw) > 0 ? [`Max power: ${station.maxPowerKw} kW`] : []),
    ...(Number(station.totalConnectors) > 0 ? [`Total connectors: ${station.totalConnectors}`] : []),
    ...(station.address ? [`Address: ${station.address}`] : []),
    `Source: ${station.sourceName}${station.sourceUrl ? ` · ${station.sourceUrl}` : ''}`,
    ...(station.updatedAt ? [`Catalogue updated: ${String(station.updatedAt).slice(0, 10)}`] : []),
  ];
}

function stationLinks(station) {
  return [
    { href: `/station/${station.id}`, label: 'Open live station details' },
    ...(station.mapsLink ? [{ href: station.mapsLink, label: 'View on Google Maps' }] : []),
    ...(station.sourceUrl ? [{ href: station.sourceUrl, label: `Source: ${clip(station.sourceName, 40)}` }] : []),
  ];
}

function stationJsonLd(station, canonical) {
  const photoUrl = stationPhotoUrl(station);
  const connectors = station.connectorTypes ?? [];
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    additionalType: 'https://schema.org/ChargingStation',
    name: station.name,
    description: clip(stationIntro(station), 280),
    url: abs(canonical),
    address: {
      '@type': 'PostalAddress',
      streetAddress: station.address || undefined,
      addressLocality: station.city || undefined,
      addressRegion: station.state || undefined,
      addressCountry: 'IN',
    },
    geo: { '@type': 'GeoCoordinates', latitude: station.lat, longitude: station.lng },
    ...(photoUrl ? { image: photoUrl } : {}),
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Network', value: station.provider },
      ...(connectors.length ? [{ '@type': 'PropertyValue', name: 'Connectors', value: connectors.join(', ') }] : []),
      ...(Number(station.maxPowerKw) > 0
        ? [{ '@type': 'PropertyValue', name: 'Max power', value: `${station.maxPowerKw} kW` }]
        : []),
      { '@type': 'PropertyValue', name: 'Data source', value: station.sourceName },
      { '@type': 'PropertyValue', name: 'Data freshness', value: 'Point-in-time catalogue entry; open Ampo for live status' },
    ],
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(station.name, canonical),
  };
}

function routeRules(registry) {
  const search = registry.searchPages.map(page => ({
    src: '/',
    dest: `/seo/search/${page.slug}.html`,
    has: [{ type: 'query', key: 'q', value: page.q }],
  }));
  const routes = registry.routePages.map(page => ({
    src: '/',
    dest: `/seo/route/${page.slug}.html`,
    has: [
      { type: 'query', key: 'from', value: page.from },
      { type: 'query', key: 'to', value: page.to },
    ],
  }));
  // Filesystem first would serve /index.html for every curated query URL.
  return [...search, ...routes, { handle: 'filesystem' }, { src: '/(.*)', dest: '/index.html' }];
}

function sitemapXml(entries) {
  const urls = entries.map(entry => {
    const lastmod = entry.lastmod ? `\n    <lastmod>${esc(entry.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(abs(entry.loc))}</loc>${lastmod}\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function llmsTxt(registry, hotels, stations) {
  const lines = [
    '# Ampo',
    '',
    '> Ampo is an EV charging station finder for India. It helps drivers find, compare and navigate to public EV chargers.',
    '',
    'Canonical site: https://ampo.vercel.app',
    'Curated search pages use `?q=<place>&place=<google_place_id>`; route pages use `?from=<start>&to=<destination>`.',
    'Station data is point-in-time. Always open Ampo for current details.',
    '',
    '## Key pages',
    '',
    `- [Ampo home](${SITE}/)`,
    `- [All EV hotels](${SITE}/hotels/)`,
    ...registry.hubPages.map(page => `- [${page.h1}](${SITE}${page.path})`),
    '',
    '## Example curated searches',
    '',
    ...registry.searchPages.slice(0, 8).map(page => `- [${page.h1}](${SITE}${searchUrl(page)})`),
    '',
    '## Example routes',
    '',
    ...registry.routePages.slice(0, 5).map(page => `- [${page.h1}](${SITE}${routeUrl(page)})`),
    '',
    `The local hotel index contains ${hotels.length} source-attributed hotels with nearby public chargers.`,
    `The quality-gated station index contains ${stations.length} source-attributed public chargers with their own canonical /station/<id> pages.`,
    '',
    '## Example station pages',
    '',
    ...stations.slice(0, 3).map(station => `- [${clip(station.name, 70)}](${SITE}/station/${station.id})`),
    '',
  ];
  return lines.join('\n');
}

async function write(relativePath, contents) {
  const target = path.join(OUT_ROOT, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents.replace(/[ \t]+$/gm, ''), 'utf8');
  return target;
}

async function validate(registry, hotels, stations) {
  const slugs = [
    ...registry.searchPages.map(p => `search:${p.slug}`),
    ...registry.routePages.map(p => `route:${p.slug}`),
    ...registry.hubPages.map(p => `hub:${p.slug}`),
    ...hotels.map(h => `hotel:${h.id}`),
    ...stations.map(s => `station:${s.id}`),
  ];
  const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicates.length) throw new Error(`Duplicate slugs: ${duplicates.join(', ')}`);
  for (const page of registry.searchPages) {
    if (!page.q || !/^ChIJ/.test(page.placeId || '')) throw new Error(`Bad search page ${page.slug}`);
  }
  for (const page of registry.routePages) {
    if (!page.from || !page.to || page.from === page.to) throw new Error(`Bad route page ${page.slug}`);
  }
  for (const page of registry.hubPages) {
    if (!page.path?.startsWith('/ev-charging/') || !page.path.endsWith('/')) throw new Error(`Bad hub path ${page.slug}`);
  }
  for (const hotel of hotels) {
    if (!hotel.id || !hotel.name || !hotel.location || !Number.isFinite(hotel.location.lat)) {
      throw new Error(`Bad hotel ${hotel.id || '(no id)'}`);
    }
  }
  for (const station of stations) {
    if (!station.id || !/^[0-9a-f-]{36}$/i.test(station.id) || !station.name
      || !Number.isFinite(station.lat) || !Number.isFinite(station.lng)) {
      throw new Error(`Bad station ${station.id || '(no id)'}`);
    }
  }
  console.log(`SEO validate OK: ${registry.searchPages.length} search, ${registry.routePages.length} route, ${registry.hubPages.length} hub, ${hotels.length} hotel, ${stations.length} station pages`);
}

async function main() {
  const [registry, hotels, stations, assets] = await Promise.all([
    fs.readFile(REGISTRY_PATH, 'utf8').then(JSON.parse),
    fs.readFile(HOTELS_PATH, 'utf8').then(JSON.parse),
    fs.readFile(STATIONS_PATH, 'utf8').then(JSON.parse),
    readAssetTags(),
  ]);
  await validate(registry, hotels.hotels, stations.stations);
  if (validateOnly) return;

  const routes = routeRules(registry);
  await fs.writeFile(ROUTES_OUT, JSON.stringify(routes, null, 2), 'utf8');

  for (const page of registry.searchPages) {
    const canonical = searchUrl(page);
    await write(`seo/search/${page.slug}.html`, shell({
      title: page.title,
      description: page.description,
      canonical,
      h1: page.h1,
      intro: page.intro,
      links: [
        { href: canonical, label: `Open live ${page.q} results` },
        { href: '/ev-charging/ev-charging-near-me/', label: 'Chargers near me' },
      ],
      jsonLd: searchJsonLd(page, canonical),
      assets,
    }));
  }

  for (const page of registry.routePages) {
    const canonical = routeUrl(page);
    await write(`seo/route/${page.slug}.html`, shell({
      title: page.title,
      description: page.description,
      canonical,
      h1: page.h1,
      intro: page.intro,
      links: [
        { href: canonical, label: 'Open this route in Ampo' },
        { href: '/ev-charging/ev-road-trip-planner/', label: 'EV road trip planner' },
      ],
      jsonLd: routeJsonLd(page, canonical),
      assets,
    }));
  }

  for (const page of registry.hubPages) {
    await write(`${page.path.replace(/^\/+/, '')}index.html`, shell({
      title: page.title,
      description: page.description,
      canonical: page.path,
      h1: page.h1,
      intro: page.intro,
      bullets: page.bullets,
      links: [
        { href: page.ctaQuery ? `/?q=${encodeURIComponent(page.ctaQuery)}` : '/', label: page.ctaLabel },
        { href: '/hotels/', label: 'Hotels with EV charging' },
      ],
      jsonLd: hubJsonLd(page),
      assets,
    }));
  }

  const hotelListLinks = [
    { href: '/', label: 'Find public chargers' },
    { href: '/ev-charging/hotels-with-ev-charging/', label: 'About this index' },
  ];
  await write('hotels/index.html', shell({
    title: 'Hotels with EV Charging in India | Ampo',
    description: 'Browse 180+ source-attributed hotels near real public EV chargers in popular Indian tourist destinations.',
    canonical: '/hotels/',
    h1: 'Hotels with EV charging in India',
    intro: `A curated index of ${hotels.hotels.length} hotels across ${hotels.areas.length} tourist areas. Each hotel is linked to real public charging places found through Google Places; a nearby charger is never described as on-site charging.`,
    bullets: [
      `${hotels.areas.length} tourist destinations`,
      `${hotels.hotels.length} hotels with verified nearby public chargers`,
      `Chargers checked within ${hotels.method.radiusMeters / 1000} km`,
    ],
    links: hotelListLinks,
    jsonLd: hotelIndexJsonLd(hotels.hotels),
    assets,
  }));

  for (const hotel of hotels.hotels) {
    const canonical = `/hotels/${hotel.id}/`;
    let html = shell({
      title: `${hotel.name} — Hotels with EV charging | Ampo`,
      description: `${hotel.name} in ${hotel.city || hotel.area}, ${hotel.state}. ${hotel.ev?.label ?? 'Public EV chargers nearby'}. Source-attributed hotel and charger data on Ampo.`,
      canonical,
      h1: hotelH1(hotel),
      intro: hotelIntro(hotel),
      bullets: hotelBullets(hotel),
      links: hotelLinks(hotel, canonical),
      jsonLd: hotelJsonLd(hotel, canonical),
      assets,
    });
    const photo = hotel.photo?.localPath
      || (hotel.photo?.reference
        ? `/api/place-photo?ref=${encodeURIComponent(hotel.photo.reference)}&width=640`
        : null);
    if (photo) {
      html = html.replace(
        '<h1>' + esc(hotelH1(hotel)) + '</h1>',
        `<img class="ampo-photo" src="${esc(photo)}" alt="${esc(hotel.name)}" width="640" height="360" />\n          <h1>${esc(hotelH1(hotel))}</h1>`
      );
    }
    await write(`hotels/${hotel.id}/index.html`, html);
  }

  // Only the dist pass writes station shells. Writing 5.6K files into public/
  // makes local `vercel dev` watchers noisy; production still gets them from
  // the postbuild pass into dist/.
  if (distMode) for (const station of stations.stations) {
    const canonical = `/station/${station.id}`;
    const photoUrl = stationPhotoUrl(station);
    await write(`station/${station.id}.html`, shell({
      title: `${clip(stationH1(station), 80)} | Ampo`,
      description: clip(stationIntro(station), 220),
      canonical,
      h1: stationH1(station),
      intro: stationIntro(station),
      bullets: stationBullets(station),
      links: stationLinks(station),
      queryMap: stationQueryMap(station, registry),
      photo: photoUrl ? { src: photoUrl, alt: station.name } : null,
      jsonLd: stationJsonLd(station, canonical),
      assets,
    }));
  }

  const sitemapEntries = [
    { loc: '/' },
    ...registry.searchPages.map(page => ({ loc: searchUrl(page) })),
    ...registry.routePages.map(page => ({ loc: routeUrl(page) })),
    ...registry.hubPages.map(page => ({ loc: page.path })),
    { loc: '/hotels/' },
    ...hotels.hotels.map(hotel => ({ loc: `/hotels/${hotel.id}/`, lastmod: String(hotel.provenance?.retrievedAt ?? hotels.generatedAt).slice(0, 10) })),
    ...stations.stations.map(station => ({
      loc: `/station/${station.id}`,
      lastmod: station.updatedAt ? String(station.updatedAt).slice(0, 10) : undefined,
    })),
  ];
  await write('sitemap.xml', sitemapXml(sitemapEntries));
  await write('llms.txt', llmsTxt(registry, hotels.hotels, stations.stations));

  const queryRoutes = routes.filter(route => route.has?.length).length;
  console.log(`${distMode ? 'dist' : 'public'} SEO pages generated: ${sitemapEntries.length} sitemap URLs (${stations.stations.length} station shells), ${queryRoutes} query routes`);
  console.log(`Vercel routes snippet: ${ROUTES_OUT}`);
}

await main();
