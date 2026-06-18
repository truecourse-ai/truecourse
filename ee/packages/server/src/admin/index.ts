/**
 * The Admin console API (enterprise) — a cross-org operator surface.
 *
 * Every route is gated by `requireOperator`: only a platform operator (a WorkOS
 * user with `metadata.role === 'operator'`, surfaced as `eeUser.isOperator`) may
 * call it. Operators see ALL workspaces' data; an optional `?org=` narrows to one
 * tenant. Regular members never reach these routes (403) and never see the nav.
 *
 * Surfaces today: LLM traces (the AI-observability store) and background jobs.
 * The customer-scoped tier (a workspace admin seeing only their own org) is a
 * later addition — it would relax the gate to the WorkOS `role` and force the
 * request's org scope.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuthUser, EeServerRegistry, TraceStatus, JobStatus } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import type { EeDb } from '@truecourse/ee-db';
import { JobStore, type PgTraceStore } from '@truecourse/ee-data-store';
import { captureEeException } from '../observability/sentry.js';

function eeUserOf(req: Request): AuthUser | undefined {
  return (req as Request & { eeUser?: AuthUser }).eeUser;
}

/** Gate: platform operators only. Everyone else gets 403. */
function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (!eeUserOf(req)?.isOperator) {
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
const traceStatus = (v: unknown): TraceStatus | undefined =>
  v === 'ok' || v === 'error' ? v : undefined;
const jobStatus = (v: unknown): JobStatus | undefined =>
  v === 'queued' || v === 'running' || v === 'succeeded' || v === 'failed' ? v : undefined;

export interface RegisterAdminOptions {
  db: EeDb;
  /** The LLM trace store (built in `installEeStores`, shared with the transport). */
  traceStore: PgTraceStore;
}

/** Build the operator-gated admin router (exported so route tests can mount it). */
export function createAdminRouter(opts: RegisterAdminOptions): Router {
  const { db, traceStore } = opts;
  const jobStore = new JobStore(db);
  const router = Router();
  router.use(requireOperator);

  const fail = (req: Request, res: Response, err: unknown, route: string): void => {
    log.error(`[ee-admin] ${route} failed: ${(err as Error).message}`);
    captureEeException(err, { component: 'admin', orgId: eeUserOf(req)?.organizationId ?? undefined, route });
    res.status(500).json({ error: 'admin request failed' });
  };

  // --- LLM traces (the AI-observability store) ------------------------------
  // Specific paths first; `/:id` is registered last so it can't swallow them.

  router.get('/traces', async (req, res) => {
    try {
      const q = req.query;
      const traces = await traceStore.list({
        org: str(q.org),
        stage: str(q.stage),
        status: traceStatus(q.status),
        promptHash: str(q.promptHash),
        traceId: str(q.traceId),
        before: str(q.before),
        limit: num(q.limit),
      });
      res.json({ traces });
    } catch (err) {
      fail(req, res, err, 'GET /api/ee/admin/traces');
    }
  });

  router.get('/traces/orgs', async (req, res) => {
    try {
      res.json({ orgs: await traceStore.listOrgs() });
    } catch (err) {
      fail(req, res, err, 'GET /api/ee/admin/traces/orgs');
    }
  });

  router.get('/traces/stats', async (req, res) => {
    try {
      res.json(await traceStore.stats({ org: str(req.query.org), since: str(req.query.since) }));
    } catch (err) {
      fail(req, res, err, 'GET /api/ee/admin/traces/stats');
    }
  });

  router.get('/traces/by-prompt/:hash', async (req, res) => {
    try {
      const traces = await traceStore.listByPromptHash(req.params.hash, {
        org: str(req.query.org),
        limit: num(req.query.limit),
      });
      res.json({ traces });
    } catch (err) {
      fail(req, res, err, 'GET /api/ee/admin/traces/by-prompt');
    }
  });

  router.get('/traces/:id', async (req, res) => {
    try {
      const trace = await traceStore.get(req.params.id, str(req.query.org));
      if (!trace) {
        res.status(404).json({ error: 'trace not found' });
        return;
      }
      res.json({ trace });
    } catch (err) {
      fail(req, res, err, 'GET /api/ee/admin/traces/:id');
    }
  });

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
