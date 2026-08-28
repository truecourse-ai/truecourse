/**
 * WorkOS configuration, read from the environment. `loadWorkosConfig()`
 * throws if a required value is missing — the server boots authenticated
 * or not at all, rather than half-authenticated.
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
  if (!v) throw new Error(`[auth] Missing required env var ${name}`);
  return v;
}

export function loadWorkosConfig(): WorkosConfig {
  const cookiePassword = required('WORKOS_COOKIE_PASSWORD');
  if (cookiePassword.length < 32) {
    throw new Error('[auth] WORKOS_COOKIE_PASSWORD must be at least 32 characters');
  }
  return {
    apiKey: required('WORKOS_API_KEY'),
    clientId: required('WORKOS_CLIENT_ID'),
    // `||` rather than `??`: deployment templates (docker compose) pass the
    // optional vars through as empty strings, which must fall back too.
    redirectUri:
      process.env.WORKOS_REDIRECT_URI || 'http://localhost:3001/api/auth/callback',
    cookiePassword,
    appUrl: process.env.WORKOS_APP_URL || 'http://localhost:3000',
  };
}
