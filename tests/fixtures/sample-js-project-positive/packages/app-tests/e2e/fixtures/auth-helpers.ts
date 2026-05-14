
// Playwright APIRequestContext.fetch() in E2E test — timeout managed by Playwright runner, not AbortSignal
interface PlaywrightApiContext { fetch(url: string, options?: Record<string, unknown>): Promise<PlaywrightResponse>; }
interface PlaywrightResponse { ok(): boolean; json(): Promise<unknown>; }

declare const apiRequestContext: PlaywrightApiContext;

async function authenticateTestUser(email: string, password: string): Promise<{ token: string }> {
  const response = await apiRequestContext.fetch('/api/auth/login', {
    method: 'POST',
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error('Authentication request failed');
  }
  return response.json() as Promise<{ token: string }>;
}
