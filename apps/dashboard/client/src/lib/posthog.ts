/**
 * Product analytics: what only the browser can see, sent to PostHog.
 *
 * ONE PROJECT, two sources. The landing site sends to the same project tagged
 * `source: 'landing'`; everything from this app carries `source: 'dashboard'`,
 * registered once at init so no call site can forget it.
 *
 * WHAT IS SENT: autocaptured clicks and form submits, a pageview per address
 * (the SPA's route changes are manual — {@link trackPageview} — because only
 * the first load is a real navigation), who is signed in, and the one named
 * event of {@link EVENTS} that never reaches this server: following the Discord
 * link out. Every product ACTION is the server's to send, from the place the
 * fact becomes true — the row written, the job claimed, the provider probed —
 * because that is where it is true whoever or whatever asked, and no navigation
 * can race it.
 *
 * OFF WITH ONE FLAG: `VITE_POSTHOG_DISABLED=1` in the build's environment and
 * `initPostHog` does nothing, which leaves every helper below a no-op — they
 * all answer to the same `initialized` flag, so a self-hosted build sends
 * nothing at all rather than being trusted to avoid the call sites.
 */

import posthog from 'posthog-js';

/**
 * The project the dashboard and the landing site share. Project API keys are
 * write-only and meant to be shipped to the browser, so it is a default rather
 * than required setup; `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` point a build
 * at another project (staging, a self-hosted PostHog).
 */
const DEFAULT_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const DEFAULT_HOST = 'https://us.i.posthog.com';

/** Which of the two clients an event came from. */
const SOURCE = 'dashboard';

/** The PostHog group every event of a signed-in session is attributed to. */
const GROUP = 'workspace';

/**
 * The named events this client sends. The names are here rather than at the
 * call sites so the catalogue is readable in one place and a name cannot drift
 * between the place that fires it and the place that reads it.
 */
export const EVENTS = {
  /** The account menu's Join Discord link was followed, off to another site. */
  discordJoinClicked: 'discord_join_clicked',
} as const;

export type AnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS];

/** Who is signed in, in the shape PostHog identifies a person by. */
export interface AnalyticsIdentity {
  /** The session's user id; the email stands in when a provider has none. */
  id?: string | null;
  email: string;
  name?: string;
  /** The workspace the session is in, the group every event is attributed to. */
  workspaceId?: string | null;
  workspaceName?: string | null;
}

let initialized = false;

/** The build was told to send nothing. */
function disabled(): boolean {
  const flag = import.meta.env.VITE_POSTHOG_DISABLED as string | undefined;
  return flag === '1' || flag === 'true';
}

/**
 * Start the client. Safe to call more than once — only the first call does
 * anything — and it does nothing at all with the opt-out flag set or with no
 * browser to run in.
 */
export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (disabled()) return;

  const key = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) || DEFAULT_KEY;
  const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || DEFAULT_HOST;

  posthog.init(key, {
    api_host: host,
    // The first load is the only navigation the browser makes; the router's
    // address changes are captured by `trackPageview`.
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage+cookie',
    loaded: (ph) => ph.register({ source: SOURCE }),
  });

  initialized = true;
}

/** One address change of the SPA, as a pageview. */
export function trackPageview(path: string): void {
  if (!initialized) return;
  posthog.capture('$pageview', { $current_url: window.location.origin + path });
}

/** One named action. */
export function trackEvent(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/**
 * Name the person behind the session, and the workspace they are in. The
 * distinct id is the user id, so the same person is one person across the
 * browsers they sign in from; the email stands in only when there is no id.
 */
export function identifyUser(identity: AnalyticsIdentity): void {
  if (!initialized) return;
  const distinctId = identity.id || identity.email;
  if (!distinctId) return;
  posthog.identify(distinctId, {
    email: identity.email,
    ...(identity.name ? { name: identity.name } : {}),
  });
  if (identity.workspaceId) {
    posthog.group(GROUP, identity.workspaceId, {
      ...(identity.workspaceName ? { name: identity.workspaceName } : {}),
    });
  }
}

/** End the identified session: the next events belong to nobody again. */
export function resetUser(): void {
  if (!initialized) return;
  posthog.reset();
}
