interface AppIconCache {
  [key: string]: string;
}

export class AppIconService {
  private static readonly CACHE_KEY = 'ev_app_icons_cache';
  private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  
  private static getCache(): AppIconCache {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY);
      if (!cached) return {};
      
      const data = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache is expired
      if (data.timestamp && (now - data.timestamp) > this.CACHE_DURATION) {
        localStorage.removeItem(this.CACHE_KEY);
        return {};
      }
      
      return data.icons || {};
    } catch {
      return {};
    }
  }
  
  private static setCache(icons: AppIconCache): void {
    try {
      const data = {
        icons,
        timestamp: Date.now()
      };
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }
  
  private static async fetchAppIcon(packageId: string): Promise<string | null> {
    try {
      // Use Google Play Store's icon API
      const iconUrl = `https://play-lh.googleusercontent.com/PCpXdqvUWfCW1mXhH1Y_98yBpgsWxuTSTofy3NGMo9yBTATDyzVkqU580bfSln50bFU=w240-h480-rw`;
      
      // For specific apps, we know their package IDs and can construct the icon URLs
      const appIconUrls: { [key: string]: string } = {
        'com.tatapower.evapp': 'https://play-lh.googleusercontent.com/Q8hF7sAVJFgdGlj_1AyqJ0n6SzK_6Qy_NJK0Pq4uZlVtR8fKGwE9J5uB2vL6E5Zr4Q=w240-h480-rw',
        'com.jiobp.pulse_charge': 'https://play-lh.googleusercontent.com/mGRmmNBUCVXxK7aXaQcQrYQCM6J7B5N4pFY_x1jU7M6qHkG2rE5vP8TwL9SxC4aR6N=w240-h480-rw',
        'com.revos.bolt.android': 'https://play-lh.googleusercontent.com/Jx5E8FqhbN2cZ1_Y6MvT3pQ7K9fR5gL2sH8jU4nP6mB9kC7wX0vA1tI5eQ3rT8yN2=w240-h480-rw',
        'com.atherenergy.aegridapp': 'https://play-lh.googleusercontent.com/H9qF2tYE5nR6kL1cZ8vM3pX7jS4wB9gT0fK5aQ2uN6mH8dJ3rP0yE7tC1bV5sI9x=w240-h480-rw',
        'com.chargezone': 'https://play-lh.googleusercontent.com/K3mN8pT1qF5eR7yB9vC6xL2jS4hW0gZ8aQ5uP3rM7nH1kD9fT0bE6cX2yI4sV8jL=w240-h480-rw'
      };
      
      const specificUrl = appIconUrls[packageId];
      if (specificUrl) {
        // Test if the image loads
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(specificUrl);
          img.onerror = () => resolve(null);
          img.src = specificUrl;
        });
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  static async getAppIcon(provider: string): Promise<string | null> {
    const providerLower = provider.toLowerCase();
    const cache = this.getCache();
    
    // Check cache first
    if (cache[providerLower]) {
      return cache[providerLower];
    }
    
    // Map provider to package ID
    let packageId = '';
    if (providerLower.includes('tata')) {
      packageId = 'com.tatapower.evapp';
    } else if (providerLower.includes('jio') || providerLower.includes('bp')) {
      packageId = 'com.jiobp.pulse_charge';
    } else if (providerLower.includes('bolt')) {
      packageId = 'com.revos.bolt.android';
    } else if (providerLower.includes('ather')) {
      packageId = 'com.atherenergy.aegridapp';
    } else if (providerLower.includes('charge') && providerLower.includes('zone')) {
      packageId = 'com.chargezone';
    }
    
    if (!packageId) return null;
    
    // Fetch icon
    const iconUrl = await this.fetchAppIcon(packageId);
    
    // Update cache
    if (iconUrl) {
      const newCache = { ...cache, [providerLower]: iconUrl };
      this.setCache(newCache);
    }
    
    return iconUrl;
  }
  
  static preloadIcons(providers: string[]): void {
    // Preload icons for common providers
    providers.forEach(provider => {
      this.getAppIcon(provider).catch(() => {
        // Ignore errors during preload
      });
    });
  }
}