export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface SharePayload {
  /** Absolute or site-relative URL. Relative URLs resolve against the current origin. */
  url: string;
  title: string;
  text: string;
}

/**
 * Use the platform share sheet when the browser exposes it (mobile Safari /
 * Android Chrome), otherwise copy the link. A user dismissing the native sheet
 * is not an error and must not produce a destructive toast.
 */
export async function shareAmpoLink({ url, title, text }: SharePayload): Promise<ShareResult> {
  const absoluteUrl = new URL(url, window.location.origin).toString();

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url: absoluteUrl });
      return 'shared';
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'AbortError' || name === 'NotAllowedError') return 'cancelled';
      // A failed native sheet should still leave the user with a copied link.
    }
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(absoluteUrl);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export interface ShareTarget extends SharePayload {
  surface: 'search' | 'nearby' | 'route' | 'hotels' | 'home';
  /** Extra flat properties for analytics. */
  properties?: Record<string, string | null>;
}

/**
 * Resolve the canonical URL for the view the user is currently on. Only stable
 * query params are kept; transient state (radius, connector filters) is not
 * part of a share link. Returns null when a route has not been planned yet.
 */
export function shareTargetForView(
  activeTab: string,
  params: URLSearchParams,
): ShareTarget | null {
  if (activeTab === 'trip') {
    const from = params.get('from')?.trim() ?? '';
    const to = params.get('to')?.trim() ?? '';
    if (!from || !to) return null;
    const url = `/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return {
      url,
      surface: 'route',
      title: `EV road trip: ${from} to ${to} | Ampo`,
      text: `EV chargers on the route from ${from} to ${to}`,
      properties: { from, to },
    };
  }

  if (activeTab === 'hotels') {
    return {
      url: '/hotels/',
      surface: 'hotels',
      title: 'Hotels with EV charging in India | Ampo',
      text: 'Hotels near real public EV chargers, sourced from Google Places.',
    };
  }

  if (activeTab === 'nearby') {
    const q = params.get('q')?.trim() ?? '';
    const place = params.get('place')?.trim() ?? '';
    if (!q) {
      return {
        url: '/',
        surface: 'nearby',
        title: 'Ampo - EV charging stations finder',
        text: 'Find public EV chargers near you with Ampo.',
      };
    }
    const url = `/?q=${encodeURIComponent(q)}${place ? `&place=${encodeURIComponent(place)}` : ''}`;
    return {
      url,
      surface: 'search',
      title: `EV charging stations in ${q} | Ampo`,
      text: `Public EV chargers in ${q}`,
      properties: { query: q, place_id: place || null },
    };
  }

  return {
    url: '/',
    surface: 'home',
    title: 'Ampo - EV charging stations finder',
    text: 'Find public EV chargers near you with Ampo.',
  };
}
