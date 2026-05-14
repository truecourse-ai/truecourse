
// --- env-in-library-code shape: module-level-config-constants ---
// SSRF bypass list is built once at module load from an env var.
// This module IS the webhook assertion layer — reading process.env here is intentional.
const buildSsrfBypassHosts = (): Set<string> => {
  const raw = process.env['APP_WEBHOOK_SSRF_BYPASS_HOSTS'] ?? '';
  const hosts = new Set<string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length > 0) {
      hosts.add(trimmed);
    }
  }
  return hosts;
};

const WEBHOOK_SSRF_BYPASS_HOSTS = buildSsrfBypassHosts();
export { WEBHOOK_SSRF_BYPASS_HOSTS };
