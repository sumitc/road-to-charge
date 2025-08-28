
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Star, Map, Circle, Building2, ExternalLink, Smartphone } from 'lucide-react';
import { ChargingStation } from '@/types/station';
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
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Circle className={`w-4 h-4 ${getStatusIconColor(station.status)}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-card-foreground text-sm">{station.name}</h3>
                  <p className="text-xs text-muted-foreground">{station.provider}</p>
                  <p className="text-xs text-muted-foreground break-words">{station.address}</p>
                </div>
              </div>
              <div className="flex flex-col items-end space-y-1 ml-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNavigate}
                  className="flex items-center space-x-1 bg-red-50 hover:bg-red-100 border-red-200 text-red-600 hover:text-red-700 h-7 text-xs px-2"
                >
                  <Map className="w-3 h-3" />
                  <span>Directions</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleServiceApp}
                  className="flex items-center space-x-1 bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600 hover:text-blue-700 h-7 text-xs px-2"
                >
                  {appIconUrl ? (
                    <img src={appIconUrl} alt={`${station.provider} app`} className="w-3 h-3 rounded-sm" />
                  ) : (
                    <Smartphone className="w-3 h-3" />
                  )}
                  <span>App</span>
                </Button>
                <span className="text-xs text-muted-foreground">
                  {station.distance.toFixed(2)} km
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex-1">
                {station.connectorTypes && station.connectorTypes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {station.connectorTypes.map((type, index) => (
                      <span
                        key={index}
                        className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-200"
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="h-5"></div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFavouriteToggle}
                className={`h-6 w-6 p-0 flex-shrink-0 ml-2 ${isFavourite ? 'text-yellow-500 hover:text-yellow-600' : 'hover:text-yellow-500'}`}
              >
                <Star className={`w-3 h-3 ${isFavourite ? 'fill-current' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
