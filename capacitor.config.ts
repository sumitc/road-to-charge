import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ruvo.evcharging',
  appName: 'Ruvo',
  webDir: 'dist',
  server: {
    // Point the native wrapper at the live app so relative /api calls resolve.
    url: 'https://road-to-charge-v2.vercel.app',
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