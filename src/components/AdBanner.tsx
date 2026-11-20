import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  BannerAdSize,
} from '@capacitor-community/admob';

// Google's public test banner ID. Set VITE_ADMOB_BANNER_AD_ID in Vercel for real ads.
// The matching AdMob App ID lives in android/app/src/main/res/values/strings.xml.
const BANNER_AD_ID =
  import.meta.env.VITE_ADMOB_BANNER_AD_ID || 'ca-app-pub-3940256099942544/6300978111';

let initPromise: Promise<void> | null = null;

async function initAds() {
  if (!initPromise) {
    initPromise = (async () => {
      await AdMob.initialize();

      // UMP consent is a no-op when no GDPR message is configured in AdMob.
      try {
        const consent = await AdMob.requestConsentInfo();
        if (
          consent.status === AdmobConsentStatus.REQUIRED &&
          consent.isConsentFormAvailable
        ) {
          await AdMob.showConsentForm();
        }
      } catch (error) {
        console.warn('AdMob consent check skipped', error);
      }
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
    document.documentElement.style.setProperty(
      '--ruvo-banner-height',
      'calc(58px + env(safe-area-inset-bottom, 0px))',
    );

    (async () => {
      try {
        await initAds();
        if (cancelled) return;
        await AdMob.showBanner({
          adId: BANNER_AD_ID,
          adSize: BannerAdSize.BANNER,
          position: BannerAdPosition.BOTTOM_CENTER,
          margin: 0,
        });
      } catch (error) {
        console.warn('AdMob banner unavailable', error);
      }
    })();

    return () => {
      cancelled = true;
      document.documentElement.style.removeProperty('--ruvo-banner-height');
      void AdMob.hideBanner().catch(() => undefined);
    };
  }, []);

  if (!Capacitor.isNativePlatform()) return null;

  return <div aria-hidden="true" className="pointer-events-none h-0" />;
};
