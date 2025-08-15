import { ChargingStation } from '@/types/station';

const FAVOURITES_KEY = 'ev-finder-favourites';

export class FavouritesService {
  static getFavourites(): ChargingStation[] {
    try {
      const stored = localStorage.getItem(FAVOURITES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading favourites:', error);
      return [];
    }
  }

  static addFavourite(station: ChargingStation): void {
    try {
      const favourites = this.getFavourites();
      const exists = favourites.some(fav => fav.id === station.id);
      
      if (!exists) {
        favourites.push(station);
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
      }
    } catch (error) {
      console.error('Error adding favourite:', error);
      throw error;
    }
  }

  static removeFavourite(stationId: string): void {
    try {
      const favourites = this.getFavourites();
      const filtered = favourites.filter(fav => fav.id !== stationId);
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error removing favourite:', error);
      throw error;
    }
  }

  static isFavourite(stationId: string): boolean {
    try {
      const favourites = this.getFavourites();
      return favourites.some(fav => fav.id === stationId);
    } catch (error) {
      console.error('Error checking favourite:', error);
      return false;
    }
  }

  static clearFavourites(): void {
    try {
      localStorage.removeItem(FAVOURITES_KEY);
    } catch (error) {
      console.error('Error clearing favourites:', error);
      throw error;
    }
  }
}