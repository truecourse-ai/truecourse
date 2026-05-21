/**
 * Positive fixture for reliability/deterministic/http-call-no-timeout.
 *
 * Two FP shapes:
 *
 *   1. `fetch(new URL(..., import.meta.url))` — bundled local asset whose URL
 *      is resolved at build time from `import.meta.url`. This is a `file://`
 *      or in-process URL, not an external HTTP call. There is nothing to time
 *      out against.
 *
 *   2. `obj.fetch(...)` (member-access form, e.g. Playwright's
 *      `request.fetch()` from `page.context()`) — the `fetch` method belongs
 *      to a library object, not the global `fetch`. The rule must not
 *      conflate it with the global timeout-less browser/node `fetch`.
 */

declare const baseUrl: string;
declare const sessionPath: string;
declare const page: {
  context(): {
    request: { fetch(url: string, opts?: { method?: string }): Promise<Response> };
  };
};

export const fetchBundledAsset = () =>
  fetch(new URL(`${baseUrl}/assets/icon.ttf`, import.meta.url));

export const playwrightFetch = () => {
  const { request } = page.context();
  return request.fetch(sessionPath, { method: 'get' });
};
