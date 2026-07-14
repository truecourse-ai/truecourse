/**
 * Content-addressed hashing for the `content` table — one immutable row per
 * `(scope, sha)`. Shared by the spec and trace stores.
 */

import { createHash } from 'node:crypto';

/** `sha256-<hex>` over the bytes. */
export function sha256(bytes: Buffer): string {
  return 'sha256-' + createHash('sha256').update(bytes).digest('hex');
}
