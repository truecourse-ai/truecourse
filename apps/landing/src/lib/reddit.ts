/**
 * Reddit Pixel, so Reddit Ads can credit visits, booked checkups and answered questions to the ad
 * that brought them. Pixel ids are public by design (they ship in every
 * page's snippet).
 */
const PIXEL_ID = 'a2_jtfbjeovy2qi';

declare global {
  interface Window {
    rdt?: ((...args: unknown[]) => void) & { callQueue?: unknown[]; sendEvent?: (...args: unknown[]) => void };
  }
}

let initialized = false;

/**
 * Loads pixel.js and records the first page visit. Safe to call multiple
 * times; only the first call has effect. Skipped in SSR (no `window`) and in
 * local dev, so local traffic never reaches the Reddit Ads account.
 */
export function initRedditPixel(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV) return;

  // Calls made before pixel.js loads wait in callQueue, as Reddit's own snippet does.
  const rdt = ((...args: unknown[]) => {
    if (rdt.sendEvent) rdt.sendEvent(...args);
    else rdt.callQueue!.push(args);
  }) as NonNullable<Window['rdt']>;
  rdt.callQueue = [];
  window.rdt = rdt;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.redditstatic.com/ads/pixel.js';
  document.head.appendChild(script);

  rdt('init', PIXEL_ID);
  rdt('track', 'PageVisit');

  initialized = true;
}

/** Page visit on a react-router pathname change, called by Layout. */
export function trackRedditPageVisit(): void {
  if (!initialized) return;
  window.rdt!('track', 'PageVisit');
}

/** Reports a lead to Reddit Ads, a booked checkup or a sent hero question. */
export function trackRedditLead(): void {
  if (!initialized) return;
  window.rdt!('track', 'Lead');
}
