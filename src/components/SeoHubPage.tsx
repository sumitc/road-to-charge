import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BatteryCharging, ExternalLink } from 'lucide-react';
import { BrandTitle } from './BrandTitle';
import { SiteFooter } from './SiteFooter';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { findHubSeoPage } from '@/lib/seoPages';
import { useDynamicSeo } from '@/lib/dynamicSeo';
import { hubJsonLd } from '@/lib/seoJsonLd';

export function SeoHubPage() {
  const { slug } = useParams();
  const page = findHubSeoPage(slug);
  const jsonLd = useMemo(() => (page ? hubJsonLd(page) : null), [page]);

  useDynamicSeo({
    title: page?.title ?? 'Ampo - EV Charging Stations Finder',
    description: page?.description ?? 'Find EV charging stations near you with Ampo.',
    canonical: page?.path ?? '/',
    jsonLd,
  });

  const ctaHref = page?.ctaQuery
    ? `/?q=${encodeURIComponent(page.ctaQuery)}`
    : '/';

  return (
    <div className="min-h-screen bg-background" style={{ minHeight: '100dvh' }}>
      <header className="bg-gradient-hero px-3 py-2.5 text-primary-foreground shadow-electric sm:px-4 sm:py-4">
        <div className="max-w-4xl mx-auto">
          <BrandTitle subtitle="EV station finder" />
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-3 pb-8 pt-4 sm:p-4">
        <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 h-8">
          <Link to="/">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to Ampo
          </Link>
        </Button>

        {!page ? (
          <Card className="rounded-2xl">
            <CardContent className="p-5">
              <h1 className="text-xl font-semibold">Page not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                That EV guide is not in the curated SEO registry.
              </p>
              <Button asChild className="mt-4">
                <Link to="/">Find chargers</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <BatteryCharging className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-wide">EV charging guide</span>
              </div>
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{page.h1}</h1>
              <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">{page.intro}</p>
              {page.bullets.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {page.bullets.map(bullet => (
                    <li key={bullet} className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild>
                  <Link to={ctaHref}>
                    {page.ctaLabel} <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/hotels/">Hotels with EV charging</Link>
                </Button>
              </div>
              <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
                Ampo uses real public charging-station data from BEE, OpenStreetMap and Google Places.
                Availability and tariffs should be confirmed with the operator before travel.
              </p>
            </CardContent>
          </Card>
        )}
        <SiteFooter />
      </main>
    </div>
  );
}

export default SeoHubPage;
