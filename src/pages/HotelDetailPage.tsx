import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BatteryCharging, ExternalLink, Info, Loader2, MapPin, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BrandTitle } from '@/components/BrandTitle';
import { ContributionButton } from '@/components/ContributionButton';
import { HotelReviews } from '@/components/HotelReviews';
import { SiteFooter } from '@/components/SiteFooter';
import { StationCard } from '@/components/StationCard';
import { useDrivingDistances } from '@/hooks/useDrivingDistances';
import { hasAuthenticOnSiteEvidence, findHotel, type Charger, type Hotel } from '@/lib/hotelIndex';
import { hotelPhotoUrl } from '@/lib/hotelPhotos';
import { EVStationService } from '@/services/evStationService';
import { useDynamicSeo } from '@/lib/dynamicSeo';
import { hotelJsonLd } from '@/lib/seoJsonLd';
import { cn } from '@/lib/utils';
import type { ChargingStation } from '@/types/station';

const VISIBLE_CHARGER_LIMIT = 8;

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
  const staticHotel = findHotel(id);
  // Discovery rows keep the exact Google Place ID in the route so a shared or
  // reloaded detail page can re-verify the property without relying on memory.
  const discoveredPlaceId = id?.startsWith('google-') ? id.slice('google-'.length) : '';
  const [discoveredHotel, setDiscoveredHotel] = useState<Hotel | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const hotel = staticHotel ?? discoveredHotel;
  const [showAllChargers, setShowAllChargers] = useState(false);

  useEffect(() => {
    if (staticHotel) return;
    setDiscoveredHotel(null);
    if (!discoveredPlaceId || !/^[A-Za-z0-9_-]{10,}$/.test(discoveredPlaceId)) return;
    let active = true;
    setIsDiscovering(true);
    void EVStationService.discoverHotel({ placeId: discoveredPlaceId }).then(found => {
      if (!active) return;
      setDiscoveredHotel(found);
      setIsDiscovering(false);
    });
    return () => { active = false; };
  }, [discoveredPlaceId, staticHotel]);
  const onSite = hotel ? hasAuthenticOnSiteEvidence(hotel) : false;
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
  // The nearest row belongs at the top of the same list users already know
  // from charger search. Prefer the road distance once it arrives, but keep
  // the straight-line fallback so the order never waits on OSRM.
  const nearestFirstChargers = useMemo(() => [...chargerRows].sort((a, b) => {
    const aDistance = drivingDistances[a.station.id] ?? a.station.distance;
    const bDistance = drivingDistances[b.station.id] ?? b.station.distance;
    return aDistance - bDistance;
  }), [chargerRows, drivingDistances]);
  const visibleChargers = showAllChargers
    ? nearestFirstChargers
    : nearestFirstChargers.slice(0, VISIBLE_CHARGER_LIMIT);

  useDynamicSeo({
    title: hotel
      ? `${hotel.name} — Hotels with EV charging | Ampo`
      : isDiscovering ? 'Discovering stay | Ampo' : 'Hotel not found | Ampo',
    description: hotel
      ? `${hotel.name} in ${place}. ${hotel.ev.label}. Source-attributed hotel and charger data on Ampo.`
      : isDiscovering
        ? 'Verifying this Google Maps place and its nearby public chargers.'
        : 'This property could not be verified with a real public charger nearby.',
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
              {isDiscovering ? (
                <>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <h1 className="text-xl font-semibold">Checking this stay on Google Maps…</h1>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    We only add a property when its exact place has a real public charger nearby.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-xl font-semibold">Hotel not found</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This property could not be verified with a real public charger nearby, or it is no longer listed on Google Maps.
                  </p>
                  <Button asChild className="mt-4">
                    <Link to="/hotels/">Browse the hotel index</Link>
                  </Button>
                </>
              )}
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
                    <a
                      href="#ratings"
                      data-hotel-rating-link="true"
                      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      aria-label={`See ratings and reviews for ${hotel.name}`}
                    >
                      <Badge variant="secondary">
                        <Star className="mr-1 h-3 w-3 fill-amber-400 text-amber-400" /> {hotel.rating}
                      </Badge>
                    </a>
                  )}
                </div>

                <div className="flex flex-nowrap items-center gap-2">
                  <a
                    href="#chargers"
                    data-hotel-evidence-link="true"
                    className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    aria-label={`Jump to chargers near ${hotel.name}`}
                  >
                    <Badge
                      data-hotel-evidence="true"
                      className={cn(
                        'shrink-0',
                        onSite
                          ? 'bg-emerald-600 text-white hover:bg-emerald-600'
                          : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50',
                      )}
                    >
                      <BatteryCharging className="mr-1 h-3 w-3" /> {onSite ? 'EV on site' : 'Charger nearby'}
                    </Badge>
                  </a>
                  {hotel.sourceUrl && (
                    <Button variant="outline" size="sm" asChild className="h-8 shrink-0 px-2 text-[11px]">
                      <a data-hotel-maps-link="true" href={hotel.sourceUrl} target="_blank" rel="noopener noreferrer">
                        View on Google Maps <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>

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

                {hotel.tripadvisorUrl && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="outline" asChild>
                      <a href={hotel.tripadvisorUrl} target="_blank" rel="noopener noreferrer">
                        Tripadvisor listing <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                )}

                <p className="border-t pt-3 text-[11px] text-muted-foreground">
                  Source: {hotel.source} · Updated {String(hotel.provenance.retrievedAt).slice(0, 10)}
                </p>
              </CardContent>
            </Card>

            <HotelReviews
              placeId={hotel.provenance.placeId}
              rating={hotel.rating}
              mapsUrl={hotel.sourceUrl}
            />

            <section id="chargers" aria-label="Public chargers near this property" className="scroll-mt-20 space-y-3">
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
