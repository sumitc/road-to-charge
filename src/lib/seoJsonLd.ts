import { hasAuthenticOnSiteEvidence, type Hotel } from './hotelIndex';
import type { HubSeoPage } from './seoPages';

const SITE = 'https://ampo.vercel.app';

export function websiteJsonLd() {
  return { '@type': 'WebSite', name: 'Ampo', url: SITE };
}

export function breadcrumbJsonLd(name: string, url: string) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ampo', item: SITE },
      { '@type': 'ListItem', position: 2, name, item: `${SITE}${url}` },
    ],
  };
}

export function hubJsonLd(page: HubSeoPage) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url: `${SITE}${page.path}`,
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(page.h1, page.path),
  };
}

export function hotelJsonLd(hotel: Hotel) {
  const canonical = `/hotels/${hotel.id}/`;
  const photoUrl = hotel.photo?.localPath
    ? `${SITE}${hotel.photo.localPath}`
    : hotel.photo?.sourceUrl;
  const nearest = hotel.ev.nearestCharger;
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: hotel.name,
    description: `${hotel.name} in ${[hotel.city, hotel.state].filter(Boolean).join(', ')}. ${hotel.ev.label}`.trim(),
    url: `${SITE}${canonical}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: hotel.formattedAddress || hotel.area,
      addressLocality: hotel.city,
      addressRegion: hotel.state,
      addressCountry: 'IN',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: hotel.location.lat,
      longitude: hotel.location.lng,
    },
    ...(photoUrl ? { image: photoUrl } : {}),
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'EV evidence',
        value: hasAuthenticOnSiteEvidence(hotel)
          ? `EV on site, confirmed by ${hotel.onSiteEvidenceSource!.label}`
          : 'Public charger nearby (not an on-site claim)',
      },
      ...(nearest
        ? [{
            '@type': 'PropertyValue',
            name: 'Nearest public charger',
            value: `${nearest.provider} · ${nearest.name} · ${(nearest.distanceMeters / 1000).toFixed(2)} km`,
          }]
        : []),
    ],
    isPartOf: websiteJsonLd(),
    breadcrumb: breadcrumbJsonLd(hotel.name, canonical),
  };
}
