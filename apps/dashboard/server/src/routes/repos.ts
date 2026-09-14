import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGit } from '@truecourse/core/lib/git';
import { resolveLatestEvent } from '@truecourse/core/commands/repo-events';
import {
  readRegistry,
  getProjectBySlug,
  type RegistryEntry,
} from '@truecourse/core/config/registry';
import { removeRepoRunState } from '../services/repo-removal.service.js';
import { orgOf } from '../services/workspace-llm.service.js';
import { isVisibleTo, type RepoOwnershipLookup } from '../middleware/project.js';

/**
 * The GitHub link store, as this router uses it: which repos a workspace
 * connected, who owns one, and the ability to disconnect one. Structural, so
 * the real `GateStore` satisfies it without this module depending on the
 * GitHub package.
 */
export interface RepoLinkStore extends RepoOwnershipLookup {
  listReposForWorkspace(workspaceOrgId: string): Promise<{ repoFullName: string }[]>;
  unlinkRepo(repoFullName: string): Promise<void>;
}

export interface ReposRouterDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  githubLinks?: RepoLinkStore | null;
}

/**
 * The entry this slug names, if this caller may act on it. A slug another
 * workspace's repository owns reads as "not found" — see `isVisibleTo`.
 */
async function requireVisibleEntry(
  deps: ReposRouterDeps,
  req: Request,
  slug: string,
): Promise<RegistryEntry> {
  const entry = await getProjectBySlug(slug);
  if (!entry || !(await isVisibleTo(deps.githubLinks, req, entry))) {
    throw createAppError('Project not found', 404);
  }
  return entry;
}

/**
 * The registry rows this caller may see: exactly the repos their workspace
 * connected, from one query. No link store (GitHub App unconfigured) means no
 * connected repos and an empty home — never everyone's rows.
 */
async function visibleTo(
  deps: ReposRouterDeps,
  req: Request,
  entries: RegistryEntry[],
): Promise<RegistryEntry[]> {
  const links = deps.githubLinks;
  const org = req.user?.organizationId;
  if (!links || !org) return [];
  const mine = new Set((await links.listReposForWorkspace(org)).map((r) => r.repoFullName));
  return entries.filter((e) => mine.has(e.name));
}

export function createReposRouter(deps: ReposRouterDeps = {}): Router {
  const router: Router = Router();
  const requireEntry = (req: Request): Promise<RegistryEntry> =>
    requireVisibleEntry(deps, req, req.params.id as string);

  // GET /api/repos - The caller's workspace's connected repos (home page).
  // `latestEvent` is the repo's most recent lifecycle event (spec scan / guard
  // generate / guard run) composed from the per-repo stores' own timestamps —
  // tolerant of missing or unreadable state (`resolveLatestEvent` never throws).
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await visibleTo(deps, req, await readRegistry());
      const repos = await Promise.all(
        entries.map(async (e) => ({
          id: e.slug,
          name: e.name,
          path: e.path,
          remoteUrl: e.remoteUrl ?? null,
          latestEvent: await resolveLatestEvent(e.path),
        })),
      );
      res.json(repos);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/repos/:id - Project details.
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      let branches: string[] = [];
      // The registry tracks the default branch from gh_repos and has no local
      // checkout, so only shell out to git when a registry didn't supply it.
      // Otherwise simple-git fails on the non-path repo identity and logs
      // "git unavailable" on every load.
      let defaultBranch = entry.defaultBranch;
      let isGitRepo = true;
      if (!defaultBranch) {
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
        remoteUrl: entry.remoteUrl ?? null,
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
  // server-side run state, then drop the link row. 409 while a job we cannot
  // stop is still running. Run-state cleanup precedes the row delete for the
  // same reason the unlink hook orders it that way: a cleanup failure must
  // keep the repo connected (and retryable), never orphan its state behind a
  // deleted link.
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      await removeRepoRunState(entry.path, orgOf(req));
      await deps.githubLinks?.unlinkRepo(entry.name);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
