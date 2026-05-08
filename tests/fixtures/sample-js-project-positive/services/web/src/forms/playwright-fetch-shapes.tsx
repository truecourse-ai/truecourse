/**
 * http-call-no-timeout shape that should NOT fire:
 *
 * Playwright `APIRequestContext.fetch(...)` calls in e2e
 * fixtures. Playwright manages the timeout via the test's
 * `timeout` option; the framework cancels the request
 * automatically. The local `request` is destructured from
 * `page.context()` — recognized as a Playwright fixture.
 */

interface APIRequestContext {
  fetch(url: string, opts?: { method?: string }): Promise<Response>;
  post(url: string, opts?: { data?: object }): Promise<Response>;
}

declare const baseUrl: string;
declare const page: { context(): { request: APIRequestContext } };

export async function getCsrfToken(): Promise<string> {
  const { request } = page.context();
  const response = await request.fetch(`${baseUrl}/api/auth/csrf`, { method: "get" });
  const body: { csrfToken?: string } = (await response.json()) as { csrfToken?: string };
  return body.csrfToken ?? "";
}
