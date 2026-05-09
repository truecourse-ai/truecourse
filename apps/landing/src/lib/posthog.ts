import posthog from 'posthog-js';

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com';

let initialized = false;

/**
 * Initializes PostHog client analytics if VITE_POSTHOG_KEY is set in the
 * Vite env at build time. No-ops in dev / preview builds without a key, so
 * local development never sends events to production.
 */
export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (!KEY) {
    if (import.meta.env.DEV) {
      // Quiet hint for the dev — not a warning, just a one-line FYI.
      console.info('[posthog] disabled (set VITE_POSTHOG_KEY to enable)');
    }
    return;
  }

  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: true,    // initial page load — we track route changes manually below
    capture_pageleave: true,
    autocapture: true,         // clicks, form submits, etc.
    persistence: 'localStorage+cookie',
  });

  initialized = true;
}

/** Manual pageview, called by Layout on every react-router pathname change. */
export function trackPageview(path: string): void {
  if (!initialized) return;
  posthog.capture('$pageview', { $current_url: window.location.origin + path });
}

/**
 * Generic event capture. Safe to call before init — silently drops if PostHog
 * isn't initialized (e.g. local dev without a key).
 */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/** Identify a user by their email. Used after waitlist submission. */
export function identifyUser(email: string, traits?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.identify(email, traits);
}

export { posthog };
