/**
 * Default Google Analytics 4 measurement id. Measurement ids are public by
 * design (they ship in every page's gtag snippet).
 *
 * Override with VITE_GA_MEASUREMENT_ID for staging / experiments.
 */
const DEFAULT_MEASUREMENT_ID = 'G-L6WHW28B6Y';

const MEASUREMENT_ID =
  (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || DEFAULT_MEASUREMENT_ID;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

let initialized = false;

/**
 * Loads gtag.js and configures GA. Safe to call multiple times; only the first
 * call has effect. Skipped in SSR (no `window`) and in local dev, so local
 * traffic never reaches the GA property.
 */
export function initGA(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js reads the `arguments` object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  // The initial page load is sent by config; route changes are sent below.
  window.gtag('config', MEASUREMENT_ID);

  initialized = true;
}

/** Manual page_view, called by Layout on every react-router pathname change. */
export function trackGAPageview(path: string): void {
  if (!initialized) return;
  window.gtag('event', 'page_view', {
    page_location: window.location.origin + path,
    page_title: document.title,
  });
}
