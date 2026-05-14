
// Trailing dots removal from hostname — /\.+$/ matches ASCII dots only.
export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}



// [unknown-catch-variable] catch(err) — instanceof AppError guard before re-throw; no unguarded access
declare class AppError extends Error { code: string; static create(code: string, message: string): AppError }
declare function resolveWebhookEndpoint(url: string): Promise<{ status: number }>;

async function assertWebhookUrlReachable(url: string): Promise<void> {
  try {
    const probe = await resolveWebhookEndpoint(url);
    if (probe.status >= 400) {
      throw AppError.create('WEBHOOK_URL_UNREACHABLE', `Endpoint returned ${probe.status}`);
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw AppError.create('WEBHOOK_URL_INVALID', 'Could not reach the webhook endpoint');
  }
}
