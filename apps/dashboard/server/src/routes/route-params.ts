/**
 * Shared query-param readers for the repo-scoped routes — one definition so the
 * `?ref=`/`?pr=` contracts (the EE PR/ref switcher) can never drift between surfaces.
 */

import type { Request } from 'express';

/** Optional `?ref=<commit>` — the dashboard ref switcher (EE). Empty ⇒ latest. */
export function refOf(req: Request): string | undefined {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  return ref || undefined;
}

/** Optional `?pr=<number>` — a PR scope (EE). Lenient: a malformed value reads as
 *  absent (repo scope). Reads only — mutations use {@link parsePr}, because a write
 *  must never silently fall back to the repo scope. */
export function prOf(req: Request): number | undefined {
  const raw = typeof req.query.pr === 'string' ? req.query.pr.trim() : '';
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/** Strict `?pr=` for mutations: absent ⇒ repo scope, but a present-yet-invalid value
 *  is an error the route should 400 on — otherwise a PR-scoped write would silently
 *  land on the (committable) repo row. Mirrors the spec routes' `parsePrScope`. */
export function parsePr(req: Request): { pr: number | undefined } | { error: string } {
  if (req.query.pr === undefined) return { pr: undefined };
  const pr = Number(req.query.pr);
  if (!Number.isInteger(pr) || pr <= 0) return { error: 'pr must be a positive integer.' };
  return { pr };
}
