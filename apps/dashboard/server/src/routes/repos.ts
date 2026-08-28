import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGit } from '@truecourse/core/lib/git';
import { readProjectConfig, updateProjectConfig } from '@truecourse/core/config/project-config';
import { readLatest } from '@truecourse/core/lib/analysis-store';
import { resolveLatestEvent } from '@truecourse/core/commands/repo-events';
import { getRules } from '@truecourse/core/services/rules';
import {
  readRegistry,
  getProjectBySlug,
  type RegistryEntry,
} from '@truecourse/core/config/registry';
import { removeRepoRunState } from '../services/repo-removal.service.js';
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
  // `lastAnalyzed` comes straight from the registry so unanalyzed projects don't
  // surface a fake date. `latestEvent` is the repo's most recent lifecycle event
  // (analyze / spec scan / contracts generate / verify / guard generate|run)
  // composed from the per-repo stores' own timestamps — tolerant of missing or
  // unreadable state (`resolveLatestEvent` never throws).
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await visibleTo(deps, req, await readRegistry());
      const repos = await Promise.all(
        entries.map(async (e) => ({
          id: e.slug,
          name: e.name,
          path: e.path,
          remoteUrl: e.remoteUrl ?? null,
          lastAnalyzed: e.lastAnalyzed ?? null,
          latestEvent: await resolveLatestEvent(e.path, e.lastAnalyzed ?? null),
        })),
      );
      res.json(repos);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/repos/:id - Project details. Prefers the registry's cached
  // `lastAnalyzed`, falling back to the persisted analysis timestamp when the
  // registry doesn't track one (the gh_repos-derived registry).
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
      // `lastAnalyzed` drives the dashboard's `hasAnalysis` gate (the Violations /
      // Analytics views render an empty "No analysis yet" state when it's null).
      // The derived registry doesn't cache it, so fall back to the timestamp of
      // the actual persisted analysis — the source of truth.
      const lastAnalyzed =
        entry.lastAnalyzed ?? (await readLatest(entry.path))?.analysis.createdAt ?? null;
      res.json({
        id: entry.slug,
        name: entry.name,
        path: entry.path,
        remoteUrl: entry.remoteUrl ?? null,
        lastAnalyzed,
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

  // DELETE /api/repos/:id - Disconnect: stop the repo's running scan, drop its
  // server-side run state, then drop the link row. 409 while a scan we cannot
  // stop is still running. Run-state cleanup precedes the row delete for the
  // same reason the unlink hook orders it that way: a cleanup failure must
  // keep the repo connected (and retryable), never orphan its state behind a
  // deleted link.
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      await removeRepoRunState(entry.path);
      await deps.githubLinks?.unlinkRepo(entry.name);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/repos/:id/categories - Update per-repo enabled categories
  router.put('/:id/categories', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      const { enabledCategories } = req.body as { enabledCategories: string[] | null };
      const updated = await updateProjectConfig(entry.path, { enabledCategories });
      res.json({ enabledCategories: updated.enabledCategories ?? null });
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/repos/:id/llm - Update per-repo LLM rules toggle
  router.put('/:id/llm', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      const { enableLlmRules } = req.body as { enableLlmRules: boolean | null };
      const updated = await updateProjectConfig(entry.path, { enableLlmRules });
      res.json({ enableLlmRules: updated.enableLlmRules ?? null });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/repos/:id/config - Read per-repo config
  router.get('/:id/config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      res.json(await readProjectConfig(entry.path));
    } catch (error) {
      next(error);
    }
  });

  // GET /api/repos/:id/rules - Catalog with per-repo enabled overrides applied.
  router.get('/:id/rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      res.json(await getRules(entry.path));
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/repos/:id/rules/:ruleKey - Toggle a single rule for this repo.
  // Rule keys contain slashes so the client must URL-encode the key segment.
  router.patch('/:id/rules/:ruleKey', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await requireEntry(req);
      const ruleKey = req.params.ruleKey as string;
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        throw createAppError('Body must include `enabled: boolean`', 400);
      }

      const all = await getRules();
      if (!all.some((r) => r.key === ruleKey)) {
        throw createAppError(`Unknown rule: ${ruleKey}`, 404);
      }

      const current = await readProjectConfig(entry.path);
      const set = new Set<string>(current.disabledRules ?? []);
      if (enabled) set.delete(ruleKey);
      else set.add(ruleKey);
      await updateProjectConfig(entry.path, { disabledRules: [...set].sort() });

      res.json({ key: ruleKey, enabled });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
