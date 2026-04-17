import { Router, type Request, type Response, type NextFunction } from 'express';
import { desc } from 'drizzle-orm';
import * as fs from 'fs';
import { db } from '../config/database.js';
import { analyses } from '../db/schema.js';
import { CreateRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { getGit } from '../lib/git.js';
import { getCurrentProject } from '../config/current-project.js';
import { readProjectConfig, updateProjectConfig } from '../config/project-config.js';
import {
  readRegistry,
  getProjectBySlug,
  registerProject,
  unregisterProject,
} from '../config/registry.js';

const router: Router = Router();

/**
 * The server (until Chunk 6) is bound to exactly one project resolved from
 * cwd at startup. Every route that takes `:id` validates it matches the
 * currently-bound project's slug.
 */
function requireCurrentProject(slug: string) {
  const current = getCurrentProject();
  if (current.slug !== slug) {
    throw createAppError(
      `Project "${slug}" is not currently served. This server is bound to "${current.slug}".`,
      404,
    );
  }
  return current;
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

// GET /api/repos - List all registered projects
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

// GET /api/repos/:id - Get project details with latest analysis
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.id as string;
    const entry = getProjectBySlug(slug);
    if (!entry) throw createAppError('Project not found', 404);

    // Only the currently-bound project has a live DB to read analyses from.
    const current = getCurrentProject();
    const lastAnalyzedAt = current.slug === slug ? await latestAnalyzedAt() : null;

    const git = await getGit(entry.path);
    const branchSummary = await git.branch();

    res.json({
      id: entry.slug,
      name: entry.name,
      path: entry.path,
      lastAnalyzed: lastAnalyzedAt?.toISOString() ?? null,
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
    const slug = req.params.id as string;
    const entry = getProjectBySlug(slug);
    if (!entry) throw createAppError('Project not found', 404);

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
    const slug = req.params.id as string;
    const { enabledCategories } = req.body as { enabledCategories: string[] | null };
    const entry = requireCurrentProject(slug);
    const next = updateProjectConfig(entry.path, { enabledCategories });
    res.json({ enabledCategories: next.enabledCategories ?? null });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/llm - Update per-repo LLM rules toggle
router.put('/:id/llm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.id as string;
    const { enableLlmRules } = req.body as { enableLlmRules: boolean | null };
    const entry = requireCurrentProject(slug);
    const next = updateProjectConfig(entry.path, { enableLlmRules });
    res.json({ enableLlmRules: next.enableLlmRules ?? null });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/config - Read per-repo config.json (used by analyze/dashboard)
router.get('/:id/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.id as string;
    const entry = getProjectBySlug(slug);
    if (!entry) throw createAppError('Project not found', 404);
    res.json(readProjectConfig(entry.path));
  } catch (error) {
    next(error);
  }
});

export default router;
