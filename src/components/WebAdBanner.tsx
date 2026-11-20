import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// Both values must be set in Vercel for ads to appear. Without them the
// component is a no-op, so the app stays ad-free until AdSense is approved.
const CLIENT_ID = import.meta.env.VITE_ADSENSE_CLIENT_ID;
const SLOT_ID = import.meta.env.VITE_ADSENSE_SLOT_ID;
const ENABLED = Boolean(CLIENT_ID && SLOT_ID) && !Capacitor.isNativePlatform();

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** Bottom AdSense banner for the browser build (AdMob is native-only). */
export const WebAdBanner = () => {
  const adRef = useRef<HTMLModElement | null>(null);

  useEffect(() => {
    if (!ENABLED) return;

    document.documentElement.style.setProperty(
      '--ruvo-banner-height',
      'calc(100px + env(safe-area-inset-bottom, 0px))',
    );

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT_ID)}`;
    script.onload = () => {
      try {
        (window.adsbygoogle ??= []).push({});
      } catch (error) {
        console.warn('[RuvoAd] AdSense push failed', error);
      }
    };
    document.head.appendChild(script);

    return () => {
      script.remove();
      document.documentElement.style.removeProperty('--ruvo-banner-height');
    };
  }, []);

  if (!ENABLED) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex h-[100px] items-center justify-center border-t bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur"
    >
      <ins
        ref={adRef}
        className="adsbygoogle block h-[90px] w-full max-w-4xl"
        data-ad-client={CLIENT_ID}
        data-ad-slot={SLOT_ID}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
};
