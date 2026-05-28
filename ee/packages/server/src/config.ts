/**
 * WorkOS configuration, read from the environment. `load()` throws if a
 * required value is missing — the OSS plugin loader catches that and
 * falls back to community, so a misconfigured enterprise deploy degrades
 * loudly rather than booting half-authenticated.
 */

export interface WorkosConfig {
  apiKey: string;
  clientId: string;
  redirectUri: string;
  cookiePassword: string;
  /** Where to send the browser after login/logout (the dashboard client). */
  appUrl: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[EE] Missing required env var ${name}`);
  return v;
}

export function loadWorkosConfig(): WorkosConfig {
  const cookiePassword = required('WORKOS_COOKIE_PASSWORD');
  if (cookiePassword.length < 32) {
    throw new Error('[EE] WORKOS_COOKIE_PASSWORD must be at least 32 characters');
  }
  return {
    apiKey: required('WORKOS_API_KEY'),
    clientId: required('WORKOS_CLIENT_ID'),
    redirectUri:
      process.env.WORKOS_REDIRECT_URI ??
      'http://localhost:3001/api/ee/auth/callback',
    cookiePassword,
    appUrl: process.env.WORKOS_APP_URL ?? 'http://localhost:3000',
  };
}
