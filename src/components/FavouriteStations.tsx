import React, { useState, useEffect } from 'react';
import { Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StationCard } from './StationCard';
import { ChargingStation } from '@/types/station';
import { FavouritesService } from '@/services/favouritesService';
import { useToast } from '@/hooks/use-toast';

export const FavouriteStations: React.FC = () => {
  const [favourites, setFavourites] = useState<ChargingStation[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadFavourites();
  }, []);

  const loadFavourites = () => {
    const favs = FavouritesService.getFavourites();
    setFavourites(favs);
  };

  const handleClearAll = () => {
    if (favourites.length === 0) return;
    
    try {
      FavouritesService.clearFavourites();
      setFavourites([]);
      toast({
        title: "Favourites cleared",
        description: "All favourite stations have been removed",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not clear favourites",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      {favourites.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <Star className="w-5 h-5 text-yellow-500" />
                <span className="text-sm text-muted-foreground">
                  {favourites.length} favourite station{favourites.length !== 1 ? 's' : ''}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                className="min-h-[44px] text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Favourites List */}
      {favourites.length > 0 ? (
        <div className="space-y-3">
          {favourites.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              onFavouriteToggle={loadFavourites}
            />
          ))}
        </div>
      ) : (
        <Card className="rounded-2xl">
          <CardContent className="flex items-center justify-center p-8">
            <div className="text-center space-y-3">
              <Star className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">No favourite stations yet</p>
              <p className="text-sm text-muted-foreground">
                Star stations from the Find Stations tab to save them here
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};