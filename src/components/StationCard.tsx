import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Star, Map, Circle, Building2 } from 'lucide-react';
import { ChargingStation } from '@/types/station';
import { FavouritesService } from '@/services/favouritesService';
import { useToast } from '@/hooks/use-toast';

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
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Circle className={`w-5 h-5 ${getStatusIconColor(station.status)}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-card-foreground">{station.name}</h3>
                  <p className="text-sm text-muted-foreground">{station.provider}</p>
                  <p className="text-xs text-muted-foreground mt-1 break-words">{station.address}</p>
                </div>
              </div>
              <div className="flex flex-col items-end space-y-1 ml-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNavigate}
                  className="flex items-center space-x-1 bg-red-50 hover:bg-red-100 border-red-200 text-red-600 hover:text-red-700"
                >
                  <Map className="w-4 h-4" />
                  <span>Directions</span>
                </Button>
                <span className="text-xs text-muted-foreground">
                  {station.distance.toFixed(2)} km
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFavouriteToggle}
                className={isFavourite ? 'text-yellow-500 hover:text-yellow-600' : 'hover:text-yellow-500'}
              >
                <Star className={`w-4 h-4 ${isFavourite ? 'fill-current' : ''}`} />
              </Button>
            </div>

            {station.connectorTypes && station.connectorTypes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {station.connectorTypes.map((type, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-200"
                  >
                    {type}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};