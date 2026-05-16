
// Snippet: string array includes with string argument — correct types
declare const VALID_SCHEMES: string[];

export function isAllowedScheme(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!VALID_SCHEMES.includes(parsed.protocol.slice(0, -1).toLowerCase())) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}


// --- argument-type-mismatch FP: String.prototype.slice with two number args ---
// hostname.startsWith('[') ? hostname.slice(1, -1) : hostname — correct String.slice usage.
export function normalizeWebhookHostname(rawHost: string): string {
  const hostname = rawHost.toLowerCase();
  // Strip IPv6 brackets if present, e.g. [::1] → ::1
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return bare.replace(/\.+$/u, '');
}




// Positive: hardcoded-url — docs site URL is the canonical public documentation host and is correctly
// hardcoded in a settings page link. The docs deployment doesn't vary by environment.
export const PUBLIC_API_DOCS_URL = 'https://docs.truecourse.io/api-reference';

export function buildApiTokenSettingsLink(): { href: string; label: string } {
  return {
    href: PUBLIC_API_DOCS_URL,
    label: 'TrueCourse Public API Documentation',
  };
}

