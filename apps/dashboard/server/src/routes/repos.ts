import { Router, type Request, type Response, type NextFunction } from 'express';
import * as fs from 'fs';
import { CreateRepoSchema } from '@truecourse/shared';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGit } from '@truecourse/core/lib/git';
import { getRepoTruecourseDir } from '@truecourse/core/config/paths';
import { readProjectConfig, updateProjectConfig } from '@truecourse/core/config/project-config';
import { getRules } from '@truecourse/core/services/rules';
import {
  readRegistry,
  getProjectBySlug,
  registerProject,
  unregisterProject,
} from '@truecourse/core/config/registry';

const router: Router = Router();

async function requireRegistryEntry(slug: string) {
  const entry = await getProjectBySlug(slug);
  if (!entry) throw createAppError('Project not found', 404);
  return entry;
}

// POST /api/repos - Register a new repo
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError('Invalid request body: path is required', 400);
    }

    const repoPath = parsed.data.path;
    if (!fs.existsSync(repoPath)) {
      throw createAppError(`Path does not exist: ${repoPath}`, 400);
    }
    if (!fs.statSync(repoPath).isDirectory()) {
      throw createAppError(`Path is not a directory: ${repoPath}`, 400);
    }

    const entry = await registerProject(repoPath);
    res.status(201).json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      lastAnalyzed: null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos - List all registered projects (home page).
// Reads `lastAnalyzed` straight from the registry so unanalyzed projects
// don't surface a fake date and the list endpoint never opens any DB.
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await readRegistry();
    res.json(
      entries.map((e) => ({
        id: e.slug,
        name: e.name,
        path: e.path,
        lastAnalyzed: e.lastAnalyzed ?? null,
      })),
    );
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id - Project details. Uses the same registry-backed
// `lastAnalyzed` as the list endpoint — both views stay consistent and
// neither opens PGlite just to read a timestamp.
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    let branches: string[] = [];
    let defaultBranch: string | undefined;
    let isGitRepo = true;
    try {
      const git = await getGit(entry.path);
      const branchSummary = await git.branch();
      branches = branchSummary.all;
      defaultBranch = branchSummary.current;
    } catch (err) {
      isGitRepo = false;
      console.warn(`[repos] git unavailable for ${entry.path}:`, (err as Error).message);
    }
    res.json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      lastAnalyzed: entry.lastAnalyzed ?? null,
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
    const entry = await requireRegistryEntry(req.params.id as string);
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

// DELETE /api/repos/:id - Unregister the project, close its PGlite, and
// remove `<repo>/.truecourse/` from disk. The repo source itself is never
// touched.
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.id as string;
    const entry = await getProjectBySlug(slug);
    if (!entry) {
      throw createAppError('Project not found', 404);
    }

    const tcDir = getRepoTruecourseDir(entry.path);
    if (fs.existsSync(tcDir)) {
      fs.rmSync(tcDir, { recursive: true, force: true });
    }

    await unregisterProject(slug);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/categories - Update per-repo enabled categories
router.put('/:id/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
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
    const entry = await requireRegistryEntry(req.params.id as string);
    const { enableLlmRules } = req.body as { enableLlmRules: boolean | null };
    const updated = await updateProjectConfig(entry.path, { enableLlmRules });
    res.json({ enableLlmRules: updated.enableLlmRules ?? null });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/config - Read per-repo config.json
router.get('/:id/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    res.json(await readProjectConfig(entry.path));
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/rules - Catalog with per-repo enabled overrides applied.
router.get('/:id/rules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
    res.json(await getRules(entry.path));
  } catch (error) {
    next(error);
  }
});

// PATCH /api/repos/:id/rules/:ruleKey - Toggle a single rule for this repo.
// Rule keys contain slashes so the client must URL-encode the key segment.
router.patch('/:id/rules/:ruleKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await requireRegistryEntry(req.params.id as string);
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

export default router;
