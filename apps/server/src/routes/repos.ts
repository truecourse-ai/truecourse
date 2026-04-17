import { Router, type Request, type Response, type NextFunction } from 'express';
import { desc } from 'drizzle-orm';
import * as fs from 'fs';
import { db, withProjectDb } from '../config/database.js';
import { analyses } from '../db/schema.js';
import { CreateRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { getGit } from '../lib/git.js';
import { readProjectConfig, updateProjectConfig } from '../config/project-config.js';
import {
  readRegistry,
  getProjectBySlug,
  registerProject,
  unregisterProject,
} from '../config/registry.js';

const router: Router = Router();

function requireRegistryEntry(slug: string) {
  const entry = getProjectBySlug(slug);
  if (!entry) throw createAppError('Project not found', 404);
  return entry;
}

async function latestAnalyzedAt(): Promise<Date | null> {
  const [row] = await db.select().from(analyses).orderBy(desc(analyses.createdAt)).limit(1);
  return row?.createdAt ?? null;
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

    const entry = registerProject(repoPath);
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

// GET /api/repos - List all registered projects (home page)
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = readRegistry();
    res.json(
      entries.map((e) => ({
        id: e.slug,
        name: e.name,
        path: e.path,
        lastAnalyzed: e.lastOpened ?? null,
      })),
    );
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id - Project details (opens the project's PGlite to read
// the latest analysis timestamp).
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = requireRegistryEntry(req.params.id as string);
    const lastAnalyzedAtValue = await withProjectDb(entry, () => latestAnalyzedAt());

    const git = await getGit(entry.path);
    const branchSummary = await git.branch();

    res.json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      lastAnalyzed: lastAnalyzedAtValue?.toISOString() ?? null,
      branches: branchSummary.all,
      defaultBranch: branchSummary.current,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/branches - List git branches
router.get('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = requireRegistryEntry(req.params.id as string);
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

// DELETE /api/repos/:id - Unregister the project (filesystem + DB untouched)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.id as string;
    if (!unregisterProject(slug)) {
      throw createAppError('Project not found', 404);
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/categories - Update per-repo enabled categories
router.put('/:id/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = requireRegistryEntry(req.params.id as string);
    const { enabledCategories } = req.body as { enabledCategories: string[] | null };
    const updated = updateProjectConfig(entry.path, { enabledCategories });
    res.json({ enabledCategories: updated.enabledCategories ?? null });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/llm - Update per-repo LLM rules toggle
router.put('/:id/llm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = requireRegistryEntry(req.params.id as string);
    const { enableLlmRules } = req.body as { enableLlmRules: boolean | null };
    const updated = updateProjectConfig(entry.path, { enableLlmRules });
    res.json({ enableLlmRules: updated.enableLlmRules ?? null });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/config - Read per-repo config.json
router.get('/:id/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = requireRegistryEntry(req.params.id as string);
    res.json(readProjectConfig(entry.path));
  } catch (error) {
    next(error);
  }
});

export default router;
