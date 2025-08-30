import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.92b4a09c92e4404c929c2fa397ffeeb9',
  appName: 'road-to-charge',
  webDir: 'dist',
  server: {
    url: 'https://92b4a09c-92e4-404c-929c-2fa397ffeeb9.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP'
    }
  }
};

export default config;