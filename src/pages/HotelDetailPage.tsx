import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BatteryCharging, ExternalLink, MapPin, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BrandTitle } from '@/components/BrandTitle';
import { SiteFooter } from '@/components/SiteFooter';
import { findHotel, hotelIndex } from '@/lib/hotelIndex';
import { useDynamicSeo } from '@/lib/dynamicSeo';
import { hotelJsonLd } from '@/lib/seoJsonLd';

const HOTEL_PHOTO = '/hotels/placeholder.svg';

function formatDistance(meters: number) {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(2)} km`;
}

export function HotelDetailPage() {
  const { id } = useParams();
  const hotel = findHotel(id);
  const nearest = hotel?.ev.nearestCharger ?? null;
  const place = hotel ? [hotel.city, hotel.state].filter(Boolean).join(', ') : '';
  const jsonLd = useMemo(() => (hotel ? hotelJsonLd(hotel) : null), [hotel]);

  useDynamicSeo({
    title: hotel
      ? `${hotel.name} — Hotels with EV charging | Ampo`
      : 'Hotel not found | Ampo',
    description: hotel
      ? `${hotel.name} in ${place}. ${hotel.ev.label}. Source-attributed hotel and charger data on Ampo.`
      : 'This hotel is not in Ampo’s EV hotel index.',
    canonical: `/hotels/${id ?? ''}/`,
    jsonLd,
  });

  return (
    <div className="min-h-screen bg-background" style={{ minHeight: '100dvh' }}>
      <header className="bg-gradient-hero px-3 py-2.5 text-primary-foreground shadow-electric sm:px-4 sm:py-4">
        <div className="max-w-4xl mx-auto">
          <BrandTitle subtitle="EV station finder" />
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-3 pb-8 pt-4 sm:p-4">
        <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 h-8">
          <Link to="/hotels/">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> All EV hotels
          </Link>
        </Button>

        {!hotel ? (
          <Card className="rounded-2xl">
            <CardContent className="p-5">
              <h1 className="text-xl font-semibold">Hotel not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This property is not in the current {hotelIndex.hotels.length}-hotel index.
              </p>
              <Button asChild className="mt-4">
                <Link to="/hotels/">Browse the hotel index</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <Card className="overflow-hidden rounded-2xl">
              <CardContent className="space-y-4 p-4 sm:p-6">
                <img
                  src={hotel.photo?.localPath || HOTEL_PHOTO}
                  alt={hotel.name}
                  className="h-48 w-full rounded-xl object-cover sm:h-64"
                />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold leading-tight sm:text-2xl">{hotel.name}</h1>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {[hotel.locality, hotel.city, hotel.state].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  {hotel.rating != null && (
                    <Badge variant="secondary" className="shrink-0">
                      <Star className="mr-1 h-3 w-3 fill-amber-400 text-amber-400" /> {hotel.rating}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                    <BatteryCharging className="mr-1 h-3 w-3" /> {hotel.ev.label}
                  </Badge>
                  <Badge variant="outline">
                    {hotel.ev.chargerCountWithinRadius} chargers within {(hotel.ev.radiusMeters / 1000).toFixed(1)} km
                  </Badge>
                </div>

                {nearest && (
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Nearest verified public charger
                    </p>
                    <p className="mt-1 text-sm font-medium">{nearest.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {nearest.provider} · {formatDistance(nearest.distanceMeters)}
                    </p>
                    <Button variant="link" size="sm" asChild className="mt-1 h-7 px-0 text-xs">
                      <a href={nearest.sourceUrl} target="_blank" rel="noopener noreferrer">
                        View charger source <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                )}

                {hotel.interestTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {hotel.interestTags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild>
                    <Link to={`/?q=${encodeURIComponent(hotel.city || hotel.area)}`}>
                      Chargers in {hotel.city || hotel.area}
                    </Link>
                  </Button>
                  {hotel.tripadvisorUrl && (
                    <Button variant="outline" asChild>
                      <a href={hotel.tripadvisorUrl} target="_blank" rel="noopener noreferrer">
                        Tripadvisor listing <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" asChild>
                    <a href={hotel.sourceUrl} target="_blank" rel="noopener noreferrer">
                      Google Maps source <ExternalLink className="ml-1 h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>

                <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                  {hotel.formattedAddress || hotel.area}. Source: {hotel.source} · Retrieved{' '}
                  {String(hotel.provenance.retrievedAt).slice(0, 10)}. A nearby public charger is not an
                  on-site charging claim. Confirm charging access with the property before travel.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        <SiteFooter />
      </main>
    </div>
  );
}

export default HotelDetailPage;
