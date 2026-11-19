
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Map,
  MapPin,
  Star,
  Building2,
  ExternalLink,
  Smartphone,
  Zap,
  Clock,
  Info,
  Car,
} from 'lucide-react';
import { ChargingStation } from '@/types/station';
import { connectorBadgeLabel, connectorSpeed } from '@/lib/connectorLabels';
import { FavouritesService } from '@/services/favouritesService';
import { useToast } from '@/hooks/use-toast';
import { AppIconService } from '@/services/appIconService';
import { cn } from '@/lib/utils';

interface StationCardProps {
  station: ChargingStation;
  userLocation?: { lat: number; lng: number } | null;
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

export const StationCard: React.FC<StationCardProps> = ({
  station,
  userLocation,
  onFavouriteToggle,
}) => {
  const { toast } = useToast();
  const isFavourite = FavouritesService.isFavourite(station.id);
  const [appIconUrl, setAppIconUrl] = useState<string | null>(null);

  useEffect(() => {
    AppIconService.getAppIcon(station.provider).then(setAppIconUrl);
  }, [station.provider]);

  const handleFavouriteToggle = () => {
    try {
      if (isFavourite) {
        FavouritesService.removeFavourite(station.id);
        toast({
          title: 'Removed from favourites',
          description: `${station.name} removed from your favourites`,
        });
      } else {
        FavouritesService.addFavourite(station);
        toast({
          title: 'Added to favourites',
          description: `${station.name} saved to your favourites`,
        });
      }
      onFavouriteToggle?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Could not update favourites',
        variant: 'destructive',
      });
    }
  };

  const handleNavigate = () => {
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`;
    window.open(googleMapsUrl, '_blank');
  };

  const handleServiceApp = () => {
    const provider = station.provider.toLowerCase();
    let appUrl = '';

    if (provider.includes('tata')) {
      appUrl = 'https://play.google.com/store/apps/details?id=com.tatapower.evapp';
    } else if (provider.includes('jio') || provider.includes('bp')) {
      appUrl = 'https://play.google.com/store/apps/details?id=com.jiobp.pulse_charge';
    } else if (provider.includes('bolt')) {
      appUrl = 'https://play.google.com/store/apps/details?id=com.revos.bolt.android';
    } else if (provider.includes('ather')) {
      appUrl = 'https://play.google.com/store/apps/details?id=com.atherenergy.aegridapp';
    } else if (provider.includes('charge') && provider.includes('zone')) {
      appUrl = 'https://play.google.com/store/apps/details?id=com.chargezone';
    } else {
      appUrl = `https://play.google.com/store/search?q=${encodeURIComponent(provider + ' EV charging app India')}`;
    }

    window.open(appUrl, '_blank');
  };

  const connectors = station.connectorTypes ?? [];
  const visibleConnectors = connectors.slice(0, 2);
  const extraConnectors = connectors.length - visibleConnectors.length;
  const status = (station.status ?? '').toLowerCase();

  return (
    <Card className="animate-fade-in overflow-hidden rounded-2xl border-border/70 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-electric">
      <CardContent className="p-4">
        <div className="flex gap-3">
          {/* Status rail */}
          <div className="flex w-3 shrink-0 flex-col items-center pt-1.5" aria-hidden="true">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full ring-4 ring-background',
                STATUS_TONE[status] ?? 'bg-slate-400'
              )}
            />
            <span className="mt-2 w-px flex-1 bg-border" />
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            {/* Title + distance */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 className="break-words text-sm font-semibold leading-snug text-card-foreground">
                  {station.name}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{station.provider}</span>
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                    {STATUS_LABEL[status] ?? station.status}
                  </span>
                </div>
              </div>
              {typeof station.distance === 'number' && (
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                  {station.distance.toFixed(1)} km
                </span>
              )}
            </div>

            {/* Address */}
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{station.address}</span>
            </p>

            {/* Connectors */}
            {connectors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {visibleConnectors.map((type, index) => {
                  const speed = connectorSpeed(type);
                  return (
                    <span
                      key={`${type}-${index}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                        SPEED_TONE[speed ?? ''] ?? 'border-blue-200 bg-blue-50 text-blue-700'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          SPEED_DOT[speed ?? ''] ?? 'bg-blue-500'
                        )}
                      />
                      {connectorBadgeLabel(type)}
                    </span>
                  );
                })}
                {extraConnectors > 0 && (
                  <span className="rounded-full border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
                    +{extraConnectors} more
                  </span>
                )}
              </div>
            )}

            {/* Quick facts */}
            {(station.maxPowerKw ||
              station.powerOutput ||
              station.availableCount !== undefined ||
              station.vehicleClasses?.length ||
              station.openingHours) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(station.maxPowerKw || station.powerOutput) && (
                  <span className="flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    {station.maxPowerKw ? `${station.maxPowerKw} kW` : station.powerOutput}
                  </span>
                )}
                {station.availableCount !== undefined && (
                  <span className="flex items-center gap-1 font-medium text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {station.availableCount} free
                    {station.totalConnectors ? ` / ${station.totalConnectors}` : ''}
                  </span>
                )}
                {station.vehicleClasses && station.vehicleClasses.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Car className="h-3.5 w-3.5" />
                    {station.vehicleClasses
                      .map(v => (v === 'car' ? 'Car' : '2W/3W'))
                      .join(', ')}
                  </span>
                )}
                {station.openingHours && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {station.openingHours}
                  </span>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 border-t pt-3">
              <Button
                size="sm"
                onClick={handleNavigate}
                className="h-10 flex-1 rounded-xl sm:flex-none"
              >
                <Map className="h-4 w-4" />
                Directions
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleServiceApp}
                className="h-10 rounded-xl"
              >
                {appIconUrl ? (
                  <img
                    src={appIconUrl}
                    alt={`${station.provider} app`}
                    className="h-4 w-4 rounded-sm"
                  />
                ) : (
                  <Smartphone className="h-4 w-4" />
                )}
                App
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                onClick={handleFavouriteToggle}
                className={cn(
                  'ml-auto h-10 w-10 rounded-xl',
                  isFavourite
                    ? 'text-amber-500 hover:text-amber-600'
                    : 'text-muted-foreground hover:text-amber-500'
                )}
              >
                <Star
                  className={cn('h-5 w-5', isFavourite && 'fill-current')}
                />
              </Button>
            </div>

            {station.sourceName && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {station.sourceName}
                  {station.dataAsOf ? ` · ${station.dataAsOf}` : ''}
                  {station.locationQuality === 'suspect' ? ' · Check location' : ''}
                </span>
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
