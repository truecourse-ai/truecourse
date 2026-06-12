/**
 * GitHub App configuration, read from the environment.
 *
 * Unlike WorkOS (which throws when misconfigured to fail the whole ee
 * plugin), this returns `null` when the GitHub App vars are absent — so an
 * enterprise deploy that only uses SSO is unaffected and the `github-gate`
 * capability simply stays off.
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
  /** Resend API key for email notifications; null when unset. */
  resendApiKey: string | null;
  /** From address for notification emails (a Resend-verified sender). */
  emailFrom: string;
  /** Postgres connection string; when set, the hosted Postgres store is used. */
  databaseUrl: string | null;
}

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
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  const appSlug = process.env.GITHUB_APP_SLUG;

  if (!appId || !privateKeyRaw || !webhookSecret || !appSlug) return null;

  return {
    appId,
    privateKey: decodePrivateKey(privateKeyRaw),
    webhookSecret,
    appSlug,
    resendApiKey: process.env.RESEND_API_KEY ?? null,
    emailFrom: process.env.RESEND_FROM ?? 'TrueCourse <noreply@truecourse.dev>',
    databaseUrl: process.env.DATABASE_URL ?? null,
  };
}
