import { hasAuthenticOnSiteEvidence, type Hotel } from './hotelIndex';
import { placePhotoUrl } from './placePhotos';
import type { HubSeoPage } from './seoPages';
import type { ChargingStation } from '@/types/station';

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

const clip = (value: string | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** Central metadata for /station/:id so static shells and live hydration agree. */
export function stationSeoMeta(station: ChargingStation) {
  const canonical = `/station/${station.id}`;
  const place = [station.city, station.state].filter(Boolean).join(', ');
  const h1 = `${station.name} — EV charging station${place ? ` in ${place}` : ''}`;
  const intro = `Public EV charging station in ${place || [station.district, station.state].filter(Boolean).join(', ') || 'India'}. ${station.provider} · data from ${station.sourceName ?? 'the Ampo station catalogue'}. This is a point-in-time catalogue entry; open Ampo for live availability and driver reports.`;
  const connectors = station.connectorTypes ?? [];
  const photoRef = station.photoRefs?.[0];
  return {
    title: `${clip(h1, 80)} | Ampo`,
    description: clip(intro, 220),
    canonical,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Place',
      additionalType: 'https://schema.org/ChargingStation',
      name: station.name,
      description: clip(intro, 280),
      url: `${SITE}${canonical}`,
      address: {
        '@type': 'PostalAddress',
        streetAddress: station.address || undefined,
        addressLocality: station.city || undefined,
        addressRegion: station.state || undefined,
        addressCountry: 'IN',
      },
      geo: { '@type': 'GeoCoordinates', latitude: station.lat, longitude: station.lng },
      ...(photoRef ? { image: `${SITE}${placePhotoUrl(photoRef)}` } : {}),
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'Network', value: station.provider },
        ...(connectors.length
          ? [{ '@type': 'PropertyValue', name: 'Connectors', value: connectors.join(', ') }]
          : []),
        ...(Number(station.maxPowerKw) > 0
          ? [{ '@type': 'PropertyValue', name: 'Max power', value: `${station.maxPowerKw} kW` }]
          : []),
        { '@type': 'PropertyValue', name: 'Data source', value: station.sourceName ?? 'Ampo station catalogue' },
        { '@type': 'PropertyValue', name: 'Data freshness', value: 'Point-in-time catalogue entry; open Ampo for live status' },
      ],
      isPartOf: websiteJsonLd(),
      breadcrumb: breadcrumbJsonLd(station.name, canonical),
    },
  };
}
