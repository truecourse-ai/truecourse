/**
 * The hosted TrueCourse app. Every "Get started" / "Sign in" link on the
 * marketing site points here, so the hostname lives in exactly one place.
 *
 * Override with VITE_APP_URL for staging or preview deployments.
 */
export const APP_URL =
  (import.meta.env.VITE_APP_URL as string | undefined) ?? 'https://app.truecourse.dev';
