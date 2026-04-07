/**
 * Async patterns that should NOT trigger any rules.
 *
 * All promises are properly awaited.
 * Properly handles errors without catching variables.
 */

interface FetchResult {
  data: string;
  status: number;
}

export async function fetchWithSignal(url: string, signal: AbortSignal): Promise<FetchResult> {
  const response = await fetch(url, { signal });
  const data = await response.text();
  return { data, status: response.status };
}

export function scheduleCleanup(callback: () => Promise<undefined>): void {
  callback().catch(() => {
    process.stderr.write('Cleanup failed\n');
  });
}

export function safeJsonParse(text: string): Record<string, unknown> {
  const empty: Record<string, unknown> = {};
  try {
    if (text.startsWith('{') && text.endsWith('}')) {
      const content: Record<string, unknown> = { parsed: true, source: text };
      return content;
    }
    return empty;
  } catch {
    return empty;
  }
}

const TIMEOUT_MS = 5000;

export async function fetchSequential(urls: readonly string[]): Promise<FetchResult[]> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const empty: FetchResult[] = [];
  try {
    const fetched = await Promise.all(urls.map((url) => fetchWithSignal(url, signal)));
    return fetched;
  } catch {
    process.stderr.write('Fetch error occurred\n');
    return empty;
  }
}

async function attemptRetry<T>(fn: () => Promise<T>, remaining: number): Promise<T> {
  try {
    return await fn();
  } catch {
    if (remaining <= 1) {
      throw new Error('All retry attempts failed');
    }
    return await attemptRetry(fn, remaining - 1);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
): Promise<T> {
  try {
    return await attemptRetry(fn, maxAttempts);
  } catch {
    throw new Error('Retry failed after all attempts');
  }
}

const HTTP_ERROR_THRESHOLD = 400;

export async function safeFetch(url: string): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const result = await fetchWithSignal(url, signal);
    if (result.status >= HTTP_ERROR_THRESHOLD) {
      return null;
    }
    return result.data;
  } catch {
    process.stderr.write('Fetch error occurred\n');
    return null;
  }
}
