/**
 * Usage, in ONE read.
 *
 *   GET /api/usage?period=7d|30d|90d|custom&from=&to=&repo=&jobType=   (default 30d)
 *
 * Workspace-scoped like every route behind the gate, and read-only. What it
 * answers is composed in `services/usage.service`; this router's whole job is
 * to say what the address means: an unknown period is the default rather than
 * a refusal (a stale link still opens), `from`/`to` are read only for a custom
 * range, `repo` is a SLUG resolved against the caller's own repositories — so
 * another workspace's repository is not found, never fetched and denied — and
 * `jobType` must be one that can spend.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
import { isVisibleTo, type RepoOwnershipLookup } from '../middleware/project.js';
import { orgOf } from '../services/workspace-llm.service.js';
import { composeUsage, isUsagePeriod, type UsageRequest } from '../services/usage.service.js';

export interface UsageRouterDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  repoLinks?: RepoOwnershipLookup | null;
}

/** A single query value; a repeated parameter names nothing in particular. */
function one(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function createUsageRouter(deps: UsageRouterDeps = {}): Router {
  const router: Router = Router();

  /** The repositories this caller can see, in the order the registry holds them. */
  async function visibleRepos(req: Request): Promise<RegistryEntry[]> {
    const visible: RegistryEntry[] = [];
    for (const entry of await readRegistry(orgOf(req))) {
      if (await isVisibleTo(deps.repoLinks, req, entry)) visible.push(entry);
    }
    return visible;
  }

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const asked = one(req.query.period);
      const request: UsageRequest = {
        workspaceOrgId: orgOf(req),
        period: isUsagePeriod(asked) ? asked : '30d',
        ...(one(req.query.from) ? { from: one(req.query.from) } : {}),
        ...(one(req.query.to) ? { to: one(req.query.to) } : {}),
        ...(one(req.query.repo) ? { repo: one(req.query.repo) } : {}),
        ...(one(req.query.jobType) ? { jobType: one(req.query.jobType) } : {}),
      };
      res.json(await composeUsage(request, await visibleRepos(req)));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
