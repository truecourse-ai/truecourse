import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../config/database.js';
import { repos, analyses, services, serviceDependencies, violations } from '../db/schema.js';
import { CreateRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { getGit } from '../lib/git.js';
import * as fs from 'fs';
import * as path from 'path';

const router: Router = Router();

// POST /api/repos - Register a new repo
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createAppError('Invalid request body: path is required', 400);
    }

    const repoPath = parsed.data.path;

    // Validate that the path exists on the filesystem
    if (!fs.existsSync(repoPath)) {
      throw createAppError(`Path does not exist: ${repoPath}`, 400);
    }

    const stat = fs.statSync(repoPath);
    if (!stat.isDirectory()) {
      throw createAppError(`Path is not a directory: ${repoPath}`, 400);
    }

    // Extract name from path
    const name = path.basename(repoPath);

    // Check if repo already exists
    const existing = await db
      .select()
      .from(repos)
      .where(eq(repos.path, repoPath))
      .limit(1);

    if (existing.length > 0) {
      res.status(200).json(existing[0]);
      return;
    }

    const [repo] = await db
      .insert(repos)
      .values({ name, path: repoPath })
      .returning();

    res.status(201).json(repo);
  } catch (error) {
    next(error);
  }
});

// GET /api/repos - List all repos
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const allRepos = await db.select().from(repos).orderBy(desc(repos.createdAt));
    res.json(allRepos.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      lastAnalyzed: r.lastAnalyzedAt?.toISOString() ?? null,
    })));
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id - Get repo details with latest analysis
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const [repo] = await db
      .select()
      .from(repos)
      .where(eq(repos.id, id))
      .limit(1);

    if (!repo) {
      throw createAppError('Repo not found', 404);
    }

    // Get latest analysis
    const latestAnalysis = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repoId, id))
      .orderBy(desc(analyses.createdAt))
      .limit(1);

    let analysisData = null;
    if (latestAnalysis.length > 0) {
      const analysis = latestAnalysis[0];

      const analysisServices = await db
        .select()
        .from(services)
        .where(eq(services.analysisId, analysis.id));

      const analysisDeps = await db
        .select()
        .from(serviceDependencies)
        .where(eq(serviceDependencies.analysisId, analysis.id));

      analysisData = {
        ...analysis,
        services: analysisServices,
        dependencies: analysisDeps,
      };
    }

    // Get git branch info
    const git = await getGit(repo.path);
    const branchSummary = await git.branch();
    const branches = branchSummary.all;
    const defaultBranch = branchSummary.current;

    res.json({
      ...repo,
      branches,
      defaultBranch,
      latestAnalysis: analysisData,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/repos/:id/branches - List git branches
router.get('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const [repo] = await db
      .select()
      .from(repos)
      .where(eq(repos.id, id))
      .limit(1);

    if (!repo) {
      throw createAppError('Repo not found', 404);
    }

    const git = await getGit(repo.path);
    const branchSummary = await git.branch();

    res.json({
      branches: branchSummary.all,
      defaultBranch: branchSummary.current,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/repos/:id - Remove repo and related data
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const [repo] = await db
      .select()
      .from(repos)
      .where(eq(repos.id, id))
      .limit(1);

    if (!repo) {
      throw createAppError('Repo not found', 404);
    }

    // Delete in correct order to respect foreign keys
    const repoAnalyses = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repoId, id));

    for (const analysis of repoAnalyses) {
      await db.delete(violations).where(eq(violations.analysisId, analysis.id));
      await db.delete(serviceDependencies).where(eq(serviceDependencies.analysisId, analysis.id));
      await db.delete(services).where(eq(services.analysisId, analysis.id));
    }

    await db.delete(analyses).where(eq(analyses.repoId, id));
    await db.delete(repos).where(eq(repos.id, id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/categories - Update per-repo disabled rule categories
router.put('/:id/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { enabledCategories } = req.body as { enabledCategories: string[] | null };

    const [repo] = await db
      .select()
      .from(repos)
      .where(eq(repos.id, id))
      .limit(1);

    if (!repo) {
      throw createAppError('Repo not found', 404);
    }

    await db
      .update(repos)
      .set({ enabledCategories, updatedAt: new Date() })
      .where(eq(repos.id, id));

    res.json({ enabledCategories });
  } catch (error) {
    next(error);
  }
});

// PUT /api/repos/:id/llm - Update per-repo LLM rules toggle
router.put('/:id/llm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { enableLlmRules } = req.body as { enableLlmRules: boolean | null };

    const [repo] = await db
      .select()
      .from(repos)
      .where(eq(repos.id, id))
      .limit(1);

    if (!repo) {
      throw createAppError('Repo not found', 404);
    }

    await db
      .update(repos)
      .set({ enableLlmRules, updatedAt: new Date() })
      .where(eq(repos.id, id));

    res.json({ enableLlmRules });
  } catch (error) {
    next(error);
  }
});

export default router;
