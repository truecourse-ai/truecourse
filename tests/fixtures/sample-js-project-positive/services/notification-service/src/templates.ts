export function renderEmail(subject: string, body: string): string {
  return `<h1>${subject}</h1><div>${body}</div>`;
}
export function renderWelcome(userName: string): string {
  return `<p>Hello ${userName}</p>`;
}
export function renderAlert(level: string, message: string): string {
  return `<strong>${level}</strong>: ${message}`;
}



// --- Email-template default parameter (preview/Storybook only) ---
interface ConfirmTeamEmailProps {
  baseUrl?: string;
  teamName: string;
}

export function ConfirmTeamEmailTemplate({
  baseUrl = 'https://documenso.com',
  teamName,
}: ConfirmTeamEmailProps): string {
  return `<a href="${baseUrl}/teams">Confirm ${teamName}</a>`;
}

// --- Canonical third-party domain deep-links ---
declare const stripeCustomerId: string;
export function getStripeDashboardLink(): string {
  return `https://dashboard.stripe.com/customers/${stripeCustomerId}`;
}
export const CHATGPT_SHARE_URL = 'https://chatgpt.com';
export const GOOGLE_OIDC_DISCOVERY = 'https://accounts.google.com/.well-known/openid-configuration';

// --- URL only in documentation / log / deprecation text ---
export function logTelemetryNotice(): void {
  console.log(
    'Telemetry is enabled. Read more at https://documenso.com/docs/telemetry to opt out.',
  );
}
export const DEPRECATED_ENDPOINT_DESCRIPTION = {
  description:
    'This endpoint is deprecated. See migration guide at https://documenso.com/docs/api/v2 for details.',
  deprecated: true,
};
export const OPENAPI_INFO_DESCRIPTION = {
  summary: 'Documenso API',
  description: 'Public API. Terms of service: https://documenso.com/terms',
};

// --- Canonical site / SEO config (Next.js metadataBase, sitemap, robots) ---
export const BASE_URL = 'https://docs.documenso.com';
export const siteMetadata = {
  metadataBase: new URL('https://docs.documenso.com'),
  title: 'Documenso Docs',
};
export function robots(): { host: string; sitemap: string } {
  return {
    host: 'https://docs.documenso.com',
    sitemap: 'https://docs.documenso.com/sitemap.xml',
  };
}

// --- Overridable env fallback + dynamic-path template literal ---
declare const process: { env: Record<string, string | undefined> };
export const LICENSE_SERVER_URL =
  process.env.INTERNAL_OVERRIDE_LICENSE_SERVER_URL || 'https://license.documenso.com';

interface GitConfig {
  user: string;
  repo: string;
  branch: string;
  contentPath: string;
}
declare const gitConfig: GitConfig;
export function getEditOnGitHubLink(slug: string): string {
  return `https://github.com/${gitConfig.user}/${gitConfig.repo}/edit/${gitConfig.branch}/${gitConfig.contentPath}/${slug}.mdx`;
}
