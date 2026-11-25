import { EVApp } from '@/components/EVApp';
import { useDynamicSeo } from '@/lib/dynamicSeo';

type AppTabPageProps = {
  tab: string;
  title: string;
};

/**
 * Non-SEO app tabs still get a real URL for sharing, refresh and back/forward.
 * They canonicalise to the homepage and stay out of the index; shared route
 * links remain on the curated `/?from=&to=` root URL.
 */
export function AppTabPage({ tab, title }: AppTabPageProps) {
  useDynamicSeo({
    title,
    description: 'Plan EV road trips or revisit saved charging stations with Ampo.',
    canonical: '/',
    robots: 'noindex,follow',
  });

  return <EVApp initialTab={tab} />;
}

export default AppTabPage;
