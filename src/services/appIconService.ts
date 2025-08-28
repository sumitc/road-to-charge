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
      // Known direct icon URLs from Google Play CDN (stable hashes can change over time)
      const appIconUrls: { [key: string]: string } = {
        'com.tatapower.evapp': 'https://play-lh.googleusercontent.com/5CmGGbaK5RCxImpt3UI4VMT-adFmrRQcI57GqV5MsDQZuVoZyfV0hVSQP8xfKofJLJ4J=w96-h96-rw',
        // Using Ather main app icon as brand indicator when Grid icon is unavailable via search result
        'com.atherenergy.aegridapp': 'https://play-lh.googleusercontent.com/3NtK-fnPGartV7EIr-5uLE6gsa-WEEPY10yFwZaUzxS9zVs81CLk31AJTGM7-_sP-Hbe=w96-h96-rw',
      };

      const specificUrl = appIconUrls[packageId];
      if (specificUrl) {
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