/**
 * Positive fixture for bugs/deterministic/await-in-loop.
 *
 * Two more FP shapes:
 *
 *   1. Sleep / wait / delay primitives. Awaiting `sleep(ms)` or
 *      `this.wait()` is by definition a time-passing operation — there's
 *      nothing to parallelise. The await *is* the loop's pacing
 *      mechanism (retry backoff, polling interval).
 *
 *   2. Cursor-based pagination with a `do { ... } while (token)` shape.
 *      Each request's `cursor` / `continuation` token comes from the
 *      previous response, so the next call depends on the previous
 *      one; the API contract enforces sequential.
 */

interface PageResponse {
  readonly count: number;
  readonly nextPageToken: string | undefined;
}

declare function fetchPage(token: string | undefined): Promise<PageResponse>;
declare function attemptOnce(): Promise<{ ok: boolean }>;
declare function recordPageCount(count: number): void;
declare function wait(ms: number): Promise<void>;

export async function retryWithBackoff(maxAttempts: number): Promise<boolean> {
  let delayMs = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await attemptOnce();
    if (result.ok) return true;
    await wait(delayMs);
    delayMs *= 2;
  }
  return false;
}

export async function walkAllPages(): Promise<void> {
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    recordPageCount(page.count);
    nextToken = page.nextPageToken;
  } while (nextToken);
}
