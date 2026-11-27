import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BatteryCharging, ExternalLink, Info, MapPin, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BrandTitle } from '@/components/BrandTitle';
import { ContributionButton } from '@/components/ContributionButton';
import { SiteFooter } from '@/components/SiteFooter';
import { StationCard } from '@/components/StationCard';
import { useDrivingDistances } from '@/hooks/useDrivingDistances';
import { hasAuthenticOnSiteEvidence, findHotel, hotelIndex, type Charger } from '@/lib/hotelIndex';
import { hotelPhotoUrl } from '@/lib/hotelPhotos';
import { useDynamicSeo } from '@/lib/dynamicSeo';
import { hotelJsonLd } from '@/lib/seoJsonLd';
import type { ChargingStation } from '@/types/station';

const VISIBLE_CHARGER_LIMIT = 8;

function formatDistance(meters: number) {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(2)} km`;
}

const AMPO_STATION_URL = /\/station\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function ampoStationId(charger: Charger) {
  return charger.sourceUrl?.match(AMPO_STATION_URL)?.[1] ?? null;
}

/** Stable key for sourced rows that have no Ampo station page of their own. */
function sourceStationId(charger: Charger) {
  return ampoStationId(charger)
    ?? `source-${[charger.sourceKind, charger.placeId, charger.name, charger.location.lat, charger.location.lng].join('|')}`;
}

/** Reuse the search-list card for hotel-scoped chargers without inventing a station page. */
function chargerToStation(charger: Charger): ChargingStation {
  return {
    id: sourceStationId(charger),
    name: charger.name,
    provider: charger.provider || 'Unlisted network',
    address: '',
    lat: charger.location.lat,
    lng: charger.location.lng,
    distance: charger.distanceMeters / 1000,
    status: 'unknown',
    connectorTypes: charger.connectors ?? [],
    googlePlaceId: charger.placeId || undefined,
    sourceName: charger.source || charger.sourceKind || 'mapped source',
    sourceUrl: charger.sourceUrl,
    mapsLink: charger.sourceUrl,
  };
}

export function HotelDetailPage() {
  const { id } = useParams();
  const hotel = findHotel(id);
  const [showAllChargers, setShowAllChargers] = useState(false);
  const onSite = hotel ? hasAuthenticOnSiteEvidence(hotel) : false;
  const nearest = hotel?.ev.nearestCharger ?? null;
  const place = hotel ? [hotel.city, hotel.state].filter(Boolean).join(', ') : '';
  const jsonLd = useMemo(() => (hotel ? hotelJsonLd(hotel) : null), [hotel]);

  // The raw index can contain the same charger from Google and the Ampo
  // catalogue. Merge by name + coordinates before showing sources to users.
  const nearbyChargers = useMemo(() => {
    const seen = new Set<string>();
    return (hotel?.ev.nearbyChargerSources ?? []).filter(charger => {
      if (!charger?.location || !Number.isFinite(charger.location.lat)) return false;
      const key = `${charger.name}|${charger.location.lat.toFixed(5)}|${charger.location.lng.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [hotel]);
  const chargerRows = useMemo(() => nearbyChargers.map(charger => ({
    station: chargerToStation(charger),
    hasDetailPage: Boolean(ampoStationId(charger)),
  })), [nearbyChargers]);
  const drivingDistances = useDrivingDistances(
    hotel?.location ?? null,
    chargerRows.map(row => ({
      id: row.station.id,
      lat: row.station.lat,
      lng: row.station.lng,
    })),
  );
  const visibleChargers = showAllChargers
    ? chargerRows
    : chargerRows.slice(0, VISIBLE_CHARGER_LIMIT);

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
                  src={hotelPhotoUrl(hotel, 800)}
                  alt={hotel.name}
                  className="h-48 w-full rounded-xl object-cover sm:h-64"
                  loading="eager"
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
                  <Badge className={onSite
                    ? 'bg-emerald-600 text-white hover:bg-emerald-600'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50'}
                  >
                    <BatteryCharging className="mr-1 h-3 w-3" /> {onSite ? 'EV on site' : 'Charger nearby'}
                  </Badge>
                  <Badge variant="outline">Nearby public chargers, not an on-site claim</Badge>
                </div>

                {nearest && (
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Nearest verified public charger
                    </p>
                    <p className="mt-1 text-sm font-medium">{nearest.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {nearest.provider} · {formatDistance(nearest.distanceMeters)} · {nearest.source || nearest.sourceKind || 'mapped source'}
                    </p>
                    {nearest.sourceUrl && (
                      <Button variant="link" size="sm" asChild className="mt-1 h-7 px-0 text-xs">
                        <a href={nearest.sourceUrl} target="_blank" rel="noopener noreferrer">
                          View charger source <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </div>
                )}

                {onSite && hotel.onSiteEvidenceSource && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                      On-site charging confirmed by an authentic source
                    </p>
                    <p className="mt-1 text-sm text-emerald-950">
                      &ldquo;{hotel.onSiteEvidenceSource.quote}&rdquo;
                    </p>
                    <Button variant="link" size="sm" asChild className="mt-1 h-7 px-0 text-xs">
                      <a href={hotel.onSiteEvidenceSource.url} target="_blank" rel="noopener noreferrer">
                        {hotel.onSiteEvidenceSource.label} <ExternalLink className="ml-1 h-3 w-3" />
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
                  {String(hotel.provenance.retrievedAt).slice(0, 10)}.{' '}
                  {onSite
                    ? 'On-site charging is based on the linked property/brand source above. Confirm access and pricing with the property before travel.'
                    : 'A nearby public charger is not an on-site charging claim. Confirm charging access with the property before travel.'}
                </p>
              </CardContent>
            </Card>

            <section id="chargers" className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Public chargers near this property
              </h2>
              <p className="text-xs leading-snug text-muted-foreground">
                Google Places reports {hotel.ev.chargerCountWithinRadius} public charging
                place{hotel.ev.chargerCountWithinRadius === 1 ? '' : 's'} within{' '}
                {(hotel.ev.radiusMeters / 1000).toFixed(1)} km. The list also includes real
                rows from OpenStreetMap and the Ampo catalogue. These are chargers near the
                hotel, not chargers owned by the property.
              </p>
              {chargerRows.length > 0 ? (
                <div className="space-y-3">
                  {visibleChargers.map(({ station, hasDetailPage }) => (
                    <StationCard
                      key={station.id}
                      station={station}
                      userLocation={hotel.location}
                      drivingDistanceKm={drivingDistances[station.id]}
                      hasDetailPage={hasDetailPage}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No individual charger rows are cached for this property yet.
                </p>
              )}
              {nearbyChargers.length > VISIBLE_CHARGER_LIMIT && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setShowAllChargers(value => !value)}
                  className="h-7 px-0 text-xs"
                >
                  {showAllChargers
                    ? 'Show fewer chargers'
                    : `Show all ${nearbyChargers.length} mapped rows`}
                </Button>
              )}
              <div id="contribute" className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  Missing a charger or an on-site update? Use the + button to submit a location
                  with a photo; we verify it on the map before publishing. Proximity alone never
                  becomes an on-site claim.
                </span>
              </div>
            </section>
          </div>
        )}
        {hotel && <ContributionButton location={hotel.location} />}
        <SiteFooter />
      </main>
    </div>
  );
}

export default HotelDetailPage;
