import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDynamicSeo } from '@/lib/dynamicSeo';
import { breadcrumbJsonLd, websiteJsonLd } from '@/lib/seoJsonLd';
import {
  findRouteSeoPage,
  findSearchSeoPage,
  routeSeoUrl,
  searchSeoUrl,
} from '@/lib/seoPages';

const SITE = 'https://ampo.vercel.app';
const ROOT_TITLE = 'Ampo - EV Charging Stations Finder';
const ROOT_DESCRIPTION =
  'Find EV charging stations near you with Ampo. Compare live availability, read real driver reviews, and get directions to chargers across India.';

/**
 * Keeps the live root view's metadata aligned with the crawler-visible static
 * shells. Only curated ?q=&place= and ?from=&to= combinations are indexable;
 * arbitrary query URLs canonicalise to / and get noindex,follow.
 */
export function useRootSeo() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q')?.trim() ?? '';
  const place = searchParams.get('place')?.trim() ?? '';
  const from = searchParams.get('from')?.trim() ?? '';
  const to = searchParams.get('to')?.trim() ?? '';

  const searchPage = q || place ? findSearchSeoPage(q || null, place || null) : undefined;
  const routePage = from && to ? findRouteSeoPage(from, to) : undefined;
  const curated = searchPage ?? routePage;
  const hasQuery = Boolean(q || place || from || to);

  const canonical = searchPage
    ? searchSeoUrl(searchPage)
    : routePage
      ? routeSeoUrl(routePage)
      : '/';

  const jsonLd = useMemo(() => {
    if (searchPage) {
      return {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: searchPage.title,
        description: searchPage.description,
        url: `${SITE}${canonical}`,
        about: {
          '@type': 'Place',
          name: searchPage.q,
          ...(searchPage.state
            ? { address: { '@type': 'PostalAddress', addressRegion: searchPage.state } }
            : {}),
        },
        isPartOf: websiteJsonLd(),
        breadcrumb: breadcrumbJsonLd(searchPage.h1, canonical),
      };
    }
    if (routePage) {
      return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: routePage.title,
        description: routePage.description,
        url: `${SITE}${canonical}`,
        about: [
          { '@type': 'Place', name: routePage.from },
          { '@type': 'Place', name: routePage.to },
        ],
        isPartOf: websiteJsonLd(),
        breadcrumb: breadcrumbJsonLd(routePage.h1, canonical),
      };
    }
    return null;
  }, [canonical, routePage, searchPage]);

  useDynamicSeo({
    title: curated?.title ?? ROOT_TITLE,
    description: curated?.description ?? ROOT_DESCRIPTION,
    canonical,
    robots: curated ? 'index,follow' : hasQuery ? 'noindex,follow' : null,
    jsonLd,
  });
}
