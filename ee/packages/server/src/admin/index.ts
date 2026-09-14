/**
 * The Admin console API (enterprise) — a cross-org operator surface.
 *
 * Every route is gated by `requireOperator`: only a platform operator (a WorkOS
 * user with `metadata.role === 'operator'`, surfaced as `user.isOperator`) may
 * call it. Operators see ALL workspaces' data; an optional `?org=` narrows to one
 * tenant. Regular members never reach these routes (403) and never see the nav.
 *
 * Surfaces today: background jobs.
 * The customer-scoped tier (a workspace admin seeing only their own org) is a
 * later addition — it would relax the gate to the WorkOS `role` and force the
 * request's org scope.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuthUser, EeServerRegistry, JobStatus } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import type { Db } from '@truecourse/db';
import { JobStore } from '@truecourse/ee-data-store';
import { captureEeException } from '../observability/sentry.js';

function userOf(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

/** Gate: platform operators only. Everyone else gets 403. */
function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (!userOf(req)?.isOperator) {
    res.status(403).json({ error: 'Operator access required.' });
    return;
  }
  next();
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};
const jobStatus = (v: unknown): JobStatus | undefined =>
  v === 'queued' || v === 'running' || v === 'succeeded' || v === 'failed' ? v : undefined;

export interface RegisterAdminOptions {
  db: Db;
}

/** Build the operator-gated admin router (exported so route tests can mount it). */
export function createAdminRouter(opts: RegisterAdminOptions): Router {
  const { db } = opts;
  const jobStore = new JobStore(db);
  const router = Router();
  router.use(requireOperator);

  const fail = (req: Request, res: Response, err: unknown, route: string): void => {
    log.error(`[ee-admin] ${route} failed: ${(err as Error).message}`);
    captureEeException(err, { component: 'admin', orgId: userOf(req)?.organizationId ?? undefined, route });
    res.status(500).json({ error: 'admin request failed' });
  };

  // --- Background jobs (cross-org) ------------------------------------------

  router.get('/jobs', async (req, res) => {
    try {
      const q = req.query;
      const jobs = await jobStore.listAll({
        org: str(q.org),
        type: str(q.type),
        status: jobStatus(q.status),
        limit: num(q.limit),
      });
      res.json({ jobs });
    } catch (err) {
      fail(req, res, err, 'GET /api/ee/admin/jobs');
    }
  });

  return router;
}

export function registerAdmin(registry: EeServerRegistry, opts: RegisterAdminOptions): void {
  registry.registerRouter('/api/ee/admin', createAdminRouter(opts));
  log.info('[ee-admin] cross-org admin console routes registered');
}
