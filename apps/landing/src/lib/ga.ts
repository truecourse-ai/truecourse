/**
 * Default Google Analytics 4 measurement id. Measurement ids are public by
 * design (they ship in every page's gtag snippet).
 *
 * Override with VITE_GA_MEASUREMENT_ID for staging / experiments.
 */
const DEFAULT_MEASUREMENT_ID = 'G-L6WHW28B6Y';

const MEASUREMENT_ID =
  (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || DEFAULT_MEASUREMENT_ID;

/** Google Ads account tag, configured on the same gtag.js as GA. Public by design. */
const ADS_ID = 'AW-18498468594';

/** The Google Ads "Book appointment" conversion. */
const ADS_BOOKING_CONVERSION = `${ADS_ID}/xLktCPT3yJQdEPL14PRE`;

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
  window.gtag('config', ADS_ID);

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

/** Reports a booked checkup to Google Ads, so bookings are credited to the ad click. */
export function trackAdsBooking(): void {
  if (!initialized) return;
  window.gtag('event', 'conversion', { send_to: ADS_BOOKING_CONVERSION, value: 1.0, currency: 'USD' });
}
