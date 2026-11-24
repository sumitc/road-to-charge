import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { BatteryCharging, ExternalLink, MapPin, RotateCcw, Search, Star } from 'lucide-react';
import affiliateLinks from '@/data/affiliateLinks.json';
import { hotelIndex as index, type Hotel } from '@/lib/hotelIndex';
import { ConnectorFilter } from '@/components/ConnectorFilter';
import { matchesConnectorFilters } from '@/lib/connectorLabels';
import { cn } from '@/lib/utils';
import { trackEmptyResult } from '@/lib/emptyResults';
const AFFILIATE_LINKS = affiliateLinks as Record<string, string>;
const HOTEL_PHOTO = '/hotels/placeholder.svg';
const hasAffiliateLinks = Object.keys(AFFILIATE_LINKS).some(key => !key.startsWith('_'));

const PRICE_OPTIONS = [...new Set(index.hotels.map(hotel => hotel.priceBand).filter(Boolean))]
  .sort() as string[];

function formatDistance(meters?: number | null) {
  if (!Number.isFinite(meters as number)) return '';
  return meters! < 1000 ? `${meters} m` : `${(meters! / 1000).toFixed(1)} km`;
}

/** Small search-results-style pill; only claim on-site charging when sourced. */
function evEvidenceTag(hotel: Hotel) {
  const onSite = hotel.evSignal === 'both' || hotel.evSignal === 'on_site_google_place';
  return {
    label: onSite ? 'EV on site' : 'Charger nearby',
    tone: onSite
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-blue-200 bg-blue-50 text-blue-700',
    dot: onSite ? 'bg-emerald-500' : 'bg-blue-500',
  };
}

type FilterSelectProps = {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function HotelCard({ hotel }: { hotel: Hotel }) {
  const affiliateUrl = AFFILIATE_LINKS[hotel.id] || '';
  const bookingUrl = affiliateUrl || hotel.sourceUrl;
  const nearest = hotel.ev.nearestCharger;
  const evidence = evEvidenceTag(hotel);
  const location = [hotel.locality, hotel.city, hotel.state].filter(Boolean).join(', ');

  return (
    <Card className="animate-fade-in overflow-hidden rounded-2xl border-border/70 shadow-sm">
      <CardContent className="p-2.5 sm:p-3">
        <div className="flex gap-3">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-primary/10 sm:h-28 sm:w-32">
            <img
              src={hotel.photo?.localPath || HOTEL_PHOTO}
              alt={hotel.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <Link to={`/hotels/${hotel.id}`} className="min-w-0 hover:underline">
                <h3 className="text-sm font-semibold leading-tight">{hotel.name}</h3>
              </Link>
            </div>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{location || hotel.area}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                evidence.tone,
              )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', evidence.dot)} />
                {evidence.label}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <BatteryCharging className="h-3 w-3 shrink-0" />
                {hotel.ev.label}
              </span>
            </div>
            {nearest && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                Nearest: {nearest.provider} · {nearest.name} · {formatDistance(nearest.distanceMeters)}
              </p>
            )}
            {hotel.ev.chargerCountWithinRadius > 1 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {hotel.ev.chargerCountWithinRadius} chargers within {(hotel.ev.radiusMeters / 1000).toFixed(1)} km
              </p>
            )}
            {hotel.rating != null && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {hotel.rating}
              </p>
            )}
          </div>
        </div>
        {hotel.onSiteEvidence && (
          <p className="mt-2 rounded-lg bg-muted/60 p-2 text-[11px] leading-snug text-muted-foreground">
            Google place text: “{hotel.onSiteEvidence}”
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            Source: {hotel.source}
            {hotel.tripadvisorUrl && (
              <> · <a href={hotel.tripadvisorUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Tripadvisor</a></>
            )}
            {hotel.photo?.sourceUrl && (
              <> · Photo: <a href={hotel.photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Google Maps</a></>
            )}
          </span>
          <Button variant="ghost" size="sm" asChild className="h-7 shrink-0 px-2 text-[11px]">
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
              {affiliateUrl ? 'Book via partner' : 'View on Google Maps'} <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function HotelsTab() {
  const [query, setQuery] = useState('');
  const [connectors, setConnectors] = useState<string[]>([]);
  const [priceBand, setPriceBand] = useState('all');

  const hotels = index.hotels;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return hotels.filter(hotel => {
      if (needle) {
        // The list is driven by the place the user cares about: hotel name,
        // locality, city or state — not by our internal EV-evidence taxonomy.
        const haystack = [
          hotel.name, hotel.area, hotel.city, hotel.state, hotel.locality,
          hotel.formattedAddress,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (!matchesConnectorFilters(hotel.ev.connectorTypes, connectors)) return false;
      if (priceBand !== 'all' && hotel.priceBand !== priceBand) return false;
      return true;
    });
  }, [connectors, hotels, priceBand, query]);

  // Count each distinct failed query/filter combination once, not on every
  // render. Clearing back to a non-empty list re-arms the same query.
  const loggedEmpty = useRef<string | null>(null);
  useEffect(() => {
    const signature = `${query.trim().toLowerCase()}::${connectors.join(',')}::${priceBand}`;
    if (filtered.length > 0) {
      loggedEmpty.current = null;
      return;
    }
    if (loggedEmpty.current === signature) return;
    loggedEmpty.current = signature;
    const filters = [connectors.length ? `connectors=${connectors.join(',')}` : '', priceBand !== 'all' ? `price=${priceBand}` : '']
      .filter(Boolean).join(',');
    trackEmptyResult({
      surface: 'hotels',
      query: query.trim() || null,
      filter: filters || undefined,
      reason: filters ? 'filters' : 'no_rows',
    });
  }, [connectors, filtered.length, priceBand, query]);

  const hasFilters = Boolean(query.trim()) || connectors.length > 0 || priceBand !== 'all';
  const reset = () => {
    setQuery('');
    setConnectors([]);
    setPriceBand('all');
  };

  const updated = useMemo(() => {
    const date = new Date(index.generatedAt);
    return Number.isNaN(date.getTime()) ? index.generatedAt : date.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }, []);

  return (
    <div className="space-y-3 px-3 pb-24 pt-3" aria-label="Hotels with EV charging">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Hotels with EV charging</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            Google Places · Updated {updated}
          </p>
        </div>
      </div>

      <form className="flex items-center gap-2" onSubmit={event => event.preventDefault()}>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="City or hotel name (e.g. Jaipur, Taj Mahal)"
            className="pl-9 text-sm"
            aria-label="Search hotels by city or hotel name"
          />
        </div>
        <Button variant="outline" size="icon" aria-label="Submit hotel search" type="submit">
          <Search className="h-4 w-4" />
        </Button>
      </form>

      <div className="space-y-2 sm:flex sm:items-center sm:gap-2">
        <ConnectorFilter
          selected={connectors}
          onChange={setConnectors}
          className="sm:w-64"
        />
        {PRICE_OPTIONS.length > 0 && (
          <FilterSelect
            label="Price band"
            value={priceBand}
            options={[
              { value: 'all', label: 'Any price' },
              ...PRICE_OPTIONS.map(value => ({ value, label: value })),
            ]}
            onChange={setPriceBand}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {filtered.length} of {hotels.length} stays · chargers within {(index.method.radiusMeters / 1000).toFixed(1)} km
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={reset} className="h-8 shrink-0 px-2 text-xs">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {filtered.length ? (
        <div className="space-y-2.5">
          {filtered.map(hotel => <HotelCard key={hotel.id} hotel={hotel} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-6 text-center">
          <p className="text-sm font-medium">
            No stays found {query.trim() ? `for “${query.trim()}”` : 'for these filters'}.
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Try a city like Jaipur or a hotel name. We only list stays with a real public charger mapped nearby.
          </p>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={reset} className="mt-3">
              Clear search and filters
            </Button>
          )}
        </div>
      )}

      {hasAffiliateLinks && (
        <p className="px-1 text-[10px] leading-snug text-muted-foreground">
          Some booking links are affiliate links. We may earn a commission at no extra cost to you.
        </p>
      )}
      <p className="px-1 pb-2 text-[10px] leading-snug text-muted-foreground">
        Connector types come from Google Places where available; stays without connector data are left out when a connector is selected. A nearby charger is not an on-site claim — confirm with the property before travel.
      </p>
    </div>
  );
}
