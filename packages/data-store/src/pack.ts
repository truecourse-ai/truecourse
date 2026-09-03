/**
 * Helpers for content-addressed packing: hashing and bounded concurrency. The
 * path-traversal guards manifest paths go through live in core
 * (`lib/safe-path.ts`) — every store that materializes stored paths shares one
 * definition — and are re-exported here for the packing call sites.
 */

import { createHash } from 'node:crypto';

export { assertSafeRel, safeJoin } from '@truecourse/core/lib/safe-path';

/** `sha256-<hex>` over the bytes. */
export function sha256(bytes: Buffer): string {
  return 'sha256-' + createHash('sha256').update(bytes).digest('hex');
}

/**
 * Run `fn` over `items` with at most `limit` in flight. On the first error,
 * stops pulling new work but lets in-flight calls settle before rejecting — so a
 * caller's cleanup (e.g. `rm` of a temp dir) can't race a still-running worker
 * that would re-create it.
 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let firstErr: unknown;
  const worker = async (): Promise<void> => {
    while (next < items.length && firstErr === undefined) {
      const i = next++;
      try {
        await fn(items[i]!, i);
      } catch (err) {
        if (firstErr === undefined) firstErr = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (firstErr !== undefined) throw firstErr;
}

/** Stable, sorted copy of a `{path: hash}` map so the manifest hash is deterministic. */
export function sortKeys(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
