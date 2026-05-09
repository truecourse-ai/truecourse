import posthog from 'posthog-js';

/**
 * Default PostHog project key — matches the one used by the CLI + dashboard
 * (`packages/core/src/services/telemetry.service.ts`). Project API keys are
 * write-only and explicitly designed to be exposed client-side, so hardcoding
 * here keeps all three sources (cli / dashboard / landing) in the same
 * PostHog project without an extra env var setup step.
 *
 * Override with VITE_POSTHOG_KEY for staging / experiments.
 */
const DEFAULT_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const DEFAULT_HOST = 'https://us.i.posthog.com';

const KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) || DEFAULT_KEY;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || DEFAULT_HOST;

/**
 * Tag every event with `source: 'landing'` so the marketing-site events are
 * distinguishable from CLI (`'cli'`) and dashboard (`'dashboard'`) events
 * inside PostHog. Mirrors what the core telemetry service does.
 */
const SOURCE = 'landing';

let initialized = false;

/**
 * Initializes PostHog client analytics. Safe to call multiple times; only the
 * first call has effect. Skipped in SSR (no `window`).
 */
export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;

  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: true,    // initial page load — route changes are handled manually below
    capture_pageleave: true,
    autocapture: true,         // clicks, form submits, etc.
    persistence: 'localStorage+cookie',
    loaded: (ph) => {
      // Tag every event from this client with source=landing. Equivalent to
      // setting it on each capture, but cheaper and impossible to forget.
      ph.register({ source: SOURCE });
    },
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
 * isn't initialized.
 */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/** Identify a user by their email. Used after waitlist submission. */
export function identifyUser(email: string, traits?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.identify(email, { ...traits, source: SOURCE });
}

export { posthog };
