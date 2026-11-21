import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ampo.evcharging',
  appName: 'Ampo',
  webDir: 'dist',
  server: {
    // Point the native wrapper at the live app so relative /api calls resolve.
    url: 'https://ampo.vercel.app',
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