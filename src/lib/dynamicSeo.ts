import { useEffect } from 'react';

const SITE = 'https://ampo.vercel.app';

const ROOT_SEO = {
  title: 'Ampo - EV Charging Stations Finder',
  description:
    'Find EV charging stations near you with Ampo. Compare live availability, read real driver reviews, and get directions to chargers across India.',
  canonical: `${SITE}/`,
  ogTitle: 'Ampo - Find EV Charging Stations Near You',
  ogDescription:
    'Discover and compare EV charging stations nearby. Live availability, real driver reviews and directions — all in one place.',
};

type SeoOptions = {
  title: string;
  description: string;
  canonical: string;
  ogTitle?: string;
  ogDescription?: string;
  robots?: string | null;
  jsonLd?: Record<string, unknown> | null;
};

function absoluteCanonical(canonical: string) {
  return canonical.startsWith('http') ? canonical : `${SITE}${canonical}`;
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.content = content;
}

function removeMeta(attribute: 'name' | 'property', key: string) {
  document.head.querySelector(`meta[${attribute}="${key}"]`)?.remove();
}

function clearSeoJsonLd() {
  document.head.querySelectorAll('script[data-ampo-seo]').forEach(script => script.remove());
}

export function useDynamicSeo({
  title,
  description,
  canonical,
  ogTitle,
  ogDescription,
  robots = null,
  jsonLd = null,
}: SeoOptions) {
  useEffect(() => {
    const canonicalUrl = absoluteCanonical(canonical);
    const resolvedOgTitle = ogTitle ?? title;
    const resolvedOgDescription = ogDescription ?? description;

    document.title = title;
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', resolvedOgTitle);
    setMeta('property', 'og:description', resolvedOgDescription);
    setMeta('property', 'og:url', canonicalUrl);
    setMeta('name', 'twitter:title', resolvedOgTitle);
    setMeta('name', 'twitter:description', resolvedOgDescription);
    setMeta('name', 'twitter:url', canonicalUrl);

    let canonicalTag = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalTag) {
      canonicalTag = document.createElement('link');
      canonicalTag.rel = 'canonical';
      document.head.appendChild(canonicalTag);
    }
    canonicalTag.href = canonicalUrl;

    if (robots) setMeta('name', 'robots', robots);
    else removeMeta('name', 'robots');

    clearSeoJsonLd();
    if (jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.ampoSeo = 'dynamic';
      // Escape "<" so a station/locality label can never close the script tag.
      script.textContent = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
      document.head.appendChild(script);
    }

    return () => {
      document.title = ROOT_SEO.title;
      const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (desc) desc.content = ROOT_SEO.description;
      setMeta('property', 'og:title', ROOT_SEO.ogTitle);
      setMeta('property', 'og:description', ROOT_SEO.ogDescription);
      setMeta('property', 'og:url', ROOT_SEO.canonical);
      setMeta('name', 'twitter:title', ROOT_SEO.ogTitle);
      setMeta('name', 'twitter:description', ROOT_SEO.ogDescription);
      setMeta('name', 'twitter:url', ROOT_SEO.canonical);
      const canon = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (canon) canon.href = ROOT_SEO.canonical;
      removeMeta('name', 'robots');
      clearSeoJsonLd();
    };
  }, [title, description, canonical, ogTitle, ogDescription, robots, jsonLd]);
}
