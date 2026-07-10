/**
 * Shared query-param readers for the repo-scoped routes — one definition so the
 * `?ref=` contract (the EE PR/ref switcher) can never drift between surfaces.
 */

import type { Request } from 'express';

/** Optional `?ref=<commit>` — the dashboard ref switcher (EE). Empty ⇒ latest. */
export function refOf(req: Request): string | undefined {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  return ref || undefined;
}
