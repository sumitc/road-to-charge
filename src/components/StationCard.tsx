
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Star, Map, Circle, Building2, ExternalLink, Smartphone, Zap, Clock, Info, Car } from 'lucide-react';
import { ChargingStation } from '@/types/station';
import { connectorBadgeLabel } from '@/lib/connectorLabels';
import { FavouritesService } from '@/services/favouritesService';
import { useToast } from '@/hooks/use-toast';
import { AppIconService } from '@/services/appIconService';

interface StationCardProps {
  station: ChargingStation;
  userLocation?: { lat: number; lng: number } | null;
  onFavouriteToggle?: () => void;
}

export const StationCard: React.FC<StationCardProps> = ({ 
  station, 
  userLocation, 
  onFavouriteToggle 
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
          title: "Removed from favourites",
          description: `${station.name} removed from your favourites`,
        });
      } else {
        FavouritesService.addFavourite(station);
        toast({
          title: "Added to favourites",
          description: `${station.name} saved to your favourites`,
        });
      }
      onFavouriteToggle?.();
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not update favourites",
        variant: "destructive",
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
      // Generic search for the provider app
      appUrl = `https://play.google.com/store/search?q=${encodeURIComponent(provider + ' EV charging app India')}`;
    }
    
    window.open(appUrl, '_blank');
  };

  const getStatusIconColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'operational':
        return 'text-green-500 fill-green-500';
      case 'maintenance':
        return 'text-yellow-500 fill-yellow-500';
      case 'out-of-service':
        return 'text-red-500 fill-red-500';
      default:
        return 'text-gray-400 fill-gray-400';
    }
  };

  return (
    <Card className="animate-fade-in hover:shadow-electric transition-all duration-300">
      <CardContent className="p-3 sm:p-4">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="p-1.5 bg-primary/10 rounded-lg shrink-0">
              <Circle className={`w-4 h-4 ${getStatusIconColor(station.status)}`} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <h3 className="font-semibold text-card-foreground text-sm break-words">{station.name}</h3>
              <p className="text-xs text-muted-foreground">{station.provider}</p>
              <p className="text-xs text-muted-foreground break-words">{station.address}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
              onClick={handleFavouriteToggle}
              className={`h-11 w-11 shrink-0 p-0 ${isFavourite ? 'text-yellow-500 hover:text-yellow-600' : 'hover:text-yellow-500'}`}
            >
              <Star className={`w-5 h-5 ${isFavourite ? 'fill-current' : ''}`} />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNavigate}
              className="min-h-[40px] bg-red-50 hover:bg-red-100 border-red-200 text-red-600 hover:text-red-700"
            >
              <Map className="w-3 h-3" />
              <span>Directions</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleServiceApp}
              className="min-h-[40px] bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600 hover:text-blue-700"
            >
              {appIconUrl ? (
                <img src={appIconUrl} alt={`${station.provider} app`} className="w-4 h-4 rounded-sm" />
              ) : (
                <Smartphone className="w-3 h-3" />
              )}
              <span>App</span>
              <ExternalLink className="w-3 h-3 opacity-80" />
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {station.distance.toFixed(2)} km
            </span>
          </div>

          {station.connectorTypes && station.connectorTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {station.connectorTypes.map((type, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-200"
                >
                  {connectorBadgeLabel(type)}
                </span>
              ))}
            </div>
          )}

          {(station.maxPowerKw || station.powerOutput || station.availableCount !== undefined || station.dataAsOf) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {(station.maxPowerKw || station.powerOutput) && (
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  <span>{station.maxPowerKw ? `${station.maxPowerKw} kW` : station.powerOutput}</span>
                </span>
              )}
              {station.availableCount !== undefined && (
                <span className="flex items-center gap-1 text-green-600">
                  <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                  <span>
                    {station.availableCount} free{station.totalConnectors ? ` / ${station.totalConnectors}` : ''}
                  </span>
                </span>
              )}
              {station.vehicleClasses && station.vehicleClasses.length > 0 && (
                <span className="flex items-center gap-1">
                  <Car className="w-3 h-3" />
                  <span>{station.vehicleClasses.map(v => v === 'car' ? 'Car' : '2W/3W').join(', ')}</span>
                </span>
              )}
              {station.openingHours && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{station.openingHours}</span>
                </span>
              )}
            </div>
          )}

          {station.sourceName && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="w-3 h-3 shrink-0" />
              <span className="min-w-0 break-words">
                {station.sourceName}{station.dataAsOf ? ` · ${station.dataAsOf}` : ''}
                {station.locationQuality === 'suspect' && ' · Check location'}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
