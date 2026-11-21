import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
} from '@capacitor-community/admob';

// Google's public test banner ID. Set VITE_ADMOB_BANNER_AD_ID in Vercel for real ads.
// The matching AdMob App ID lives in android/app/src/main/res/values/strings.xml.
const CONFIGURED_BANNER_ID = import.meta.env.VITE_ADMOB_BANNER_AD_ID;
const BANNER_AD_ID = CONFIGURED_BANNER_ID || 'ca-app-pub-3940256099942544/6300978111';
const IS_TEST_BANNER = !CONFIGURED_BANNER_ID;

let initPromise: Promise<boolean> | null = null;

async function initAds(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      await AdMob.initialize();

      let consent = await AdMob.requestConsentInfo();
      if (!consent.canRequestAds && consent.isConsentFormAvailable) {
        consent = await AdMob.showConsentForm();
      }
      // Never request an ad when UMP says ads are not allowed.
      return consent.canRequestAds;
    })();
  }
  return initPromise;
}

/**
 * Native-only AdMob banner. The ad itself is drawn by the native SDK at the
 * bottom of the screen; this reserves matching space in the web view so the
 * last station card and the floating action buttons stay reachable.
 */
export const AdBanner = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const listeners: Array<{ remove: () => Promise<void> }> = [];
    document.documentElement.style.setProperty(
      '--ampo-banner-height',
      'calc(58px + env(safe-area-inset-bottom, 0px))',
    );

    (async () => {
      try {
        const loaded = await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
          console.info('[AmpoAd] banner loaded');
        });
        const failed = await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (error) => {
          console.warn('[AmpoAd] banner failed to load', error);
        });
        listeners.push(loaded, failed);

        const canRequestAds = await initAds();
        if (cancelled || !canRequestAds) return;

        await AdMob.showBanner({
          adId: BANNER_AD_ID,
          adSize: BannerAdSize.BANNER,
          position: BannerAdPosition.BOTTOM_CENTER,
          margin: 0,
          isTesting: IS_TEST_BANNER,
        });
        console.info('[AmpoAd] showBanner requested', {
          test: IS_TEST_BANNER,
          canRequestAds,
        });
      } catch (error) {
        console.warn('[AmpoAd] AdMob banner unavailable', error);
      }
    })();

    return () => {
      cancelled = true;
      for (const listener of listeners) void listener.remove().catch(() => undefined);
      document.documentElement.style.removeProperty('--ampo-banner-height');
      void AdMob.hideBanner().catch(() => undefined);
    };
  }, []);

  if (!Capacitor.isNativePlatform()) return null;

  return <div aria-hidden="true" className="pointer-events-none h-0" />;
};
