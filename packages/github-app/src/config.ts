/**
 * GitHub App configuration, read from the environment.
 *
 * With none of the GITHUB_APP_* vars set the App is simply not configured and
 * `null` comes back, so a deployment that doesn't connect GitHub at all just
 * runs without it. With SOME of them set the boot fails, naming the missing
 * ones: a half-configured App would accept installs it cannot verify.
 */

export interface GithubAppConfig {
  /** Numeric GitHub App ID (string form). */
  appId: string;
  /** PEM private key used to mint installation tokens + sign App JWTs. */
  privateKey: string;
  /** Shared secret for verifying inbound webhook signatures. */
  webhookSecret: string;
  /** App slug, used to build the install URL (github.com/apps/<slug>). */
  appSlug: string;
  /**
   * The App's OAuth client, for "Request user authorization (OAuth) during
   * installation": the code GitHub sends back is exchanged for a user token
   * that proves which installations the person can reach.
   */
  clientId: string;
  clientSecret: string;
  /** Postgres connection string; when set, the hosted Postgres store is used. */
  databaseUrl: string | null;
}

/** The env vars an App needs, all of them or none. */
export const GITHUB_APP_ENV_VARS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
] as const;

/**
 * Accept the private key either as a raw PEM (possibly with escaped `\n`
 * newlines, common in single-line env vars) or as a base64-encoded PEM
 * (which sidesteps newline mangling entirely). Returns a normalized PEM.
 */
function decodePrivateKey(raw: string): string {
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) return decoded;
  } catch {
    // fall through — return as-is and let the GitHub client surface the error
  }
  return raw;
}

export function loadGithubAppConfig(): GithubAppConfig | null {
  const missing = GITHUB_APP_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length === GITHUB_APP_ENV_VARS.length) return null;
  if (missing.length > 0) {
    throw new Error(
      `GitHub App configuration is incomplete: set ${missing.join(', ')} (all of ${GITHUB_APP_ENV_VARS.join(', ')} together, or none of them).`,
    );
  }

  return {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: decodePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!),
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET!,
    appSlug: process.env.GITHUB_APP_SLUG!,
    clientId: process.env.GITHUB_APP_CLIENT_ID!,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
    databaseUrl: process.env.DATABASE_URL ?? null,
  };
}
