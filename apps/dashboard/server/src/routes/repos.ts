import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGit } from '@truecourse/core/lib/git';
import type { RegistryEntry } from '@truecourse/core/config/registry';
import { removeRepoRunState } from '../services/repo-removal.service.js';
import { removeRepositoryContext } from '../services/context-lifecycle.service.js';
import { listRepositorySummaries, type RepoLinkStore } from '../services/repositories.service.js';
import { orgOf } from '../services/workspace-llm.service.js';
import { resolveVisibleProject } from '../middleware/project.js';

export type { RepoLinkStore } from '../services/repositories.service.js';

export interface ReposRouterDeps {
  /** The connected repositories of every provider; null in a test app with none. */
  repoLinks?: RepoLinkStore | null;
}

/**
 * The entry this slug names in the caller's workspace, if this caller may act
 * on it; a 404 otherwise.
 */
async function requireVisibleEntry(
  deps: ReposRouterDeps,
  req: Request,
  slug: string,
): Promise<RegistryEntry> {
  const entry = await resolveVisibleProject(deps.repoLinks, req.user?.organizationId, slug);
  if (!entry) throw createAppError('Project not found', 404);
  return entry;
}

export function createReposRouter(deps: ReposRouterDeps = {}): Router {
  const router: Router = Router();
  const requireEntry = (req: Request): Promise<RegistryEntry> =>
    requireVisibleEntry(deps, req, req.params.id as string);

  // GET /api/repos - The caller's workspace's connected repos (home page).
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await listRepositorySummaries(deps.repoLinks, req.user?.organizationId));
    } catch (error) {
      next(error);
    }
  });

  // GET /api/repos/:id - Project details.
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      let branches: string[] = [];
      // A connected repository has no checkout here — its identity is a name,
      // not a path — so its branch is whatever the provider recorded and there
      // is nothing to shell out to. Only an entry no provider brought is asked.
      let defaultBranch = entry.defaultBranch;
      let isGitRepo = true;
      if (!defaultBranch && !entry.provider) {
        try {
          const git = await getGit(entry.path);
          const branchSummary = await git.branch();
          branches = branchSummary.all;
          defaultBranch = branchSummary.current;
        } catch (err) {
          isGitRepo = false;
          console.warn(`[repos] git unavailable for ${entry.path}:`, (err as Error).message);
        }
      }
      res.json({
        id: entry.slug,
        name: entry.name,
        path: entry.path,
        provider: entry.provider,
        branches,
        defaultBranch,
        isGitRepo,
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/repos/:id/branches - List git branches
  router.get('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      const git = await getGit(entry.path);
      const branchSummary = await git.branch();
      res.json({
        branches: branchSummary.all,
        defaultBranch: branchSummary.current,
      });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/repos/:id - Disconnect: stop the repo's in-flight jobs, drop its
  // server-side run state, clear its Context bindings (which tells the
  // workspace they moved), then drop the link row. 409 while a job we cannot
  // stop is still running. Run-state cleanup precedes the row delete for the
  // same reason the unlink hook orders it that way: a cleanup failure must
  // keep the repo connected (and retryable), never orphan its state behind a
  // deleted link.
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      const org = orgOf(req);
      await removeRepoRunState(entry.path, org);
      await removeRepositoryContext(org, entry.name);
      await deps.repoLinks?.unlinkRepo(entry.name);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
