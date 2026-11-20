import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ChevronRight,
  ExternalLink,
  Map,
  MapPin,
  Smartphone,
  Star,
  Zap,
} from 'lucide-react';
import { ChargingStation } from '@/types/station';
import { connectorBadgeLabel, connectorSpeed } from '@/lib/connectorLabels';
import { chargingAppUrl, directionsUrl } from '@/lib/appLinks';
import { placePhotoUrl } from '@/lib/placePhotos';
import { FavouritesService } from '@/services/favouritesService';
import { useToast } from '@/hooks/use-toast';
import { AppIconService } from '@/services/appIconService';
import { cn } from '@/lib/utils';

interface StationCardProps {
  station: ChargingStation;
  userLocation?: { lat: number; lng: number } | null;
  /** Only the Saved tab needs this; the nearby list must not refetch on a star tap. */
  onFavouriteToggle?: () => void;
}

const STATUS_TONE: Record<string, string> = {
  operational: 'bg-emerald-500',
  maintenance: 'bg-amber-500',
  'out-of-service': 'bg-rose-500',
};

const STATUS_LABEL: Record<string, string> = {
  operational: 'Available',
  maintenance: 'Maintenance',
  'out-of-service': 'Offline',
};

const SPEED_TONE: Record<string, string> = {
  'super-fast': 'border-violet-200 bg-violet-50 text-violet-700',
  fast: 'border-amber-200 bg-amber-50 text-amber-700',
  slow: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const SPEED_DOT: Record<string, string> = {
  'super-fast': 'bg-violet-500',
  fast: 'bg-amber-500',
  slow: 'bg-emerald-500',
};

const StationCardComponent: React.FC<StationCardProps> = ({ station, onFavouriteToggle }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  // Local state keeps the star instant; no list refetch on toggle.
  const [isFavourite, setIsFavourite] = useState(() => FavouritesService.isFavourite(station.id));
  const [appIconUrl, setAppIconUrl] = useState<string | null>(null);

  useEffect(() => {
    AppIconService.getAppIcon(station.provider).then(setAppIconUrl);
  }, [station.provider]);

  const handleFavouriteToggle = () => {
    try {
      if (isFavourite) {
        FavouritesService.removeFavourite(station.id);
      } else {
        FavouritesService.addFavourite(station);
      }
      setIsFavourite(!isFavourite);
      toast({
        title: isFavourite ? 'Removed from favourites' : 'Added to favourites',
        description: station.name,
      });
      onFavouriteToggle?.();
    } catch {
      toast({ title: 'Could not update favourites', variant: 'destructive' });
    }
  };

  const connectors = station.connectorTypes ?? [];
  const visibleConnectors = connectors.slice(0, 3);
  const extraConnectors = connectors.length - visibleConnectors.length;
  const status = (station.status ?? '').toLowerCase();
  const photoRef = station.photoRefs?.[0];
  const rating = station.placeDetails?.rating;

  return (
    <Card className="animate-fade-in overflow-hidden rounded-2xl border-border/70 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-electric">
      <CardContent className="p-2.5 sm:p-3">
        <button
          type="button"
          onClick={() => navigate(`/station/${station.id}`)}
          className="flex w-full min-w-0 gap-3 text-left"
          aria-label={`View details for ${station.name}`}
        >
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/15 to-emerald-500/15 sm:h-28 sm:w-32">
            {photoRef ? (
              <>
                <img
                  src={placePhotoUrl(photoRef, 320)}
                  alt={station.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                  Google Maps
                </span>
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-primary/60">
                <Zap className="h-6 w-6" />
                <span className="text-[9px] font-medium">No photo yet</span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1 py-0.5 sm:space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 break-words text-sm font-semibold leading-snug text-card-foreground">
                {station.name}
              </h3>
              {typeof station.distance === 'number' && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {station.distance.toFixed(1)} km
                </span>
              )}
            </div>

            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{station.address || station.city || 'Location on map'}</span>
            </p>

            {connectors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {visibleConnectors.map((type, index) => {
                  const speed = connectorSpeed(type);
                  return (
                    <span
                      key={`${type}-${index}`}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                        SPEED_TONE[speed ?? ''] ?? 'border-blue-200 bg-blue-50 text-blue-700'
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', SPEED_DOT[speed ?? ''] ?? 'bg-blue-500')} />
                      {connectorBadgeLabel(type)}
                    </span>
                  );
                })}
                {extraConnectors > 0 && (
                  <span className="rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    +{extraConnectors}
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="truncate">{station.provider}</span>
              <span className="flex items-center gap-1">
                <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_TONE[status] ?? 'bg-slate-400')} />
                {STATUS_LABEL[status] ?? station.status}
              </span>
              {typeof rating === 'number' && (
                <span className="flex items-center gap-0.5 font-medium text-amber-600">
                  <Star className="h-3 w-3 fill-current" /> {rating.toFixed(1)}
                </span>
              )}
              {station.locationQuality === 'suspect' && (
                <span className="text-amber-600">Check location</span>
              )}
            </div>
          </div>
        </button>

        <div className="mt-2 flex items-center gap-2 border-t pt-2 sm:mt-3 sm:pt-3">
          <Button
            size="sm"
            onClick={() => window.open(directionsUrl(station), '_blank')}
            className="h-10 flex-1 rounded-xl sm:flex-none"
          >
            <Map className="h-4 w-4" />
            Directions
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(chargingAppUrl(station), '_blank')}
            className="h-10 rounded-xl"
          >
            {appIconUrl ? (
              <img src={appIconUrl} alt={`${station.provider} app`} className="h-4 w-4 rounded-sm" />
            ) : (
              <Smartphone className="h-4 w-4" />
            )}
            App
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/station/${station.id}`)}
            className="h-10 rounded-xl"
          >
            Details
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={handleFavouriteToggle}
            className={cn(
              'ml-auto h-10 w-10 rounded-xl',
              isFavourite ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground hover:text-amber-500'
            )}
          >
            <Star className={cn('h-5 w-5', isFavourite && 'fill-current')} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export const StationCard = React.memo(StationCardComponent);
StationCard.displayName = 'StationCard';
