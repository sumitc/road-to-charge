import registry from '@/data/seoPages.json';

export type SearchSeoPage = {
  slug: string;
  q: string;
  placeId: string;
  state: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
};

export type RouteSeoPage = {
  slug: string;
  from: string;
  to: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
};

export type HubSeoPage = {
  slug: string;
  path: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  bullets: string[];
  ctaLabel: string;
  ctaQuery: string;
};

export const seoPages = registry as {
  version: number;
  generatedAt: string;
  note: string;
  searchPages: SearchSeoPage[];
  routePages: RouteSeoPage[];
  hubPages: HubSeoPage[];
};

export function searchSeoUrl(page: Pick<SearchSeoPage, 'q' | 'placeId'>): string {
  const params = new URLSearchParams({ q: page.q, place: page.placeId });
  return `/?${params.toString()}`;
}

export function routeSeoUrl(page: Pick<RouteSeoPage, 'from' | 'to'>): string {
  const params = new URLSearchParams({ from: page.from, to: page.to });
  return `/?${params.toString()}`;
}

export function findSearchSeoPage(q: string | null, placeId: string | null): SearchSeoPage | undefined {
  const normalized = q?.trim().toLowerCase();
  return seoPages.searchPages.find(page =>
    (placeId && page.placeId === placeId) ||
    (!placeId && page.q.toLowerCase() === normalized)
  );
}

export function findRouteSeoPage(from: string | null, to: string | null): RouteSeoPage | undefined {
  const a = from?.trim().toLowerCase();
  const b = to?.trim().toLowerCase();
  if (!a || !b) return undefined;
  return seoPages.routePages.find(page =>
    page.from.toLowerCase() === a && page.to.toLowerCase() === b
  );
}

export function findHubSeoPage(slug: string | undefined): HubSeoPage | undefined {
  const segment = slug?.replace(/^\/+|\/+$/g, '');
  const pathSegment = (path: string) => path.split('/').filter(Boolean).at(-1);
  return seoPages.hubPages.find(page =>
    page.slug === segment || pathSegment(page.path) === segment
  );
}
