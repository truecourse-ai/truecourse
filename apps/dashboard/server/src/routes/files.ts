/**
 * Filesystem + git-surface endpoints scoped to a repo.
 *
 *   GET /files         — `git ls-files`, optionally plus untracked for working-tree refs
 *   GET /file-content  — contents of one file, from HEAD or the working tree
 *   GET /changes       — dirty files + which services they touch, for pre-diff UI
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGit } from '@truecourse/core/lib/git';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readLatest } from '@truecourse/core/lib/analysis-store';

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/files — git ls-files
// ---------------------------------------------------------------------------

router.get('/:id/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const ref = req.query.ref as string | undefined;
    const repo = resolveProjectForRequest(id);

    const git = await getGit(repo.path);
    const result = await git.raw(['ls-files']);
    const files = result.split('\n').filter((f) => f.length > 0);

    if (ref === 'working-tree') {
      const untrackedResult = await git.raw(['ls-files', '--others', '--exclude-standard']);
      const untrackedFiles = untrackedResult.split('\n').filter((f) => f.length > 0);
      for (const f of untrackedFiles) {
        if (!files.includes(f)) files.push(f);
      }
    }

    res.json({ root: repo.path, files });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/file-content — read file from repo
// ---------------------------------------------------------------------------

router.get('/:id/file-content', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const filePath = req.query.path as string;
    const ref = req.query.ref as string | undefined;
    if (!filePath) throw createAppError('Missing "path" query parameter', 400);

    const repo = resolveProjectForRequest(id);
    const resolved = path.resolve(repo.path, filePath);
    if (
      !resolved.startsWith(path.resolve(repo.path) + path.sep) &&
      resolved !== path.resolve(repo.path)
    ) {
      throw createAppError('Path traversal not allowed', 403);
    }

    let content: string;

    if (ref === 'working-tree') {
      if (!fs.existsSync(resolved)) throw createAppError('File not found', 404);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) throw createAppError('Path is not a file', 400);
      content = fs.readFileSync(resolved, 'utf-8');
    } else {
      const git = await getGit(repo.path);
      try {
        content = await git.show([`HEAD:${filePath}`]);
      } catch {
        if (!fs.existsSync(resolved)) throw createAppError('File not found', 404);
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) throw createAppError('Path is not a file', 400);
        content = fs.readFileSync(resolved, 'utf-8');
      }
    }

    const ext = path.extname(resolved).slice(1).toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', md: 'markdown', css: 'css', html: 'html', yaml: 'yaml',
      yml: 'yaml', sql: 'sql', sh: 'shell', py: 'python', go: 'go',
      rs: 'rust', java: 'java', rb: 'ruby', php: 'php', c: 'c',
      cpp: 'cpp', h: 'c', hpp: 'cpp',
    };
    const language = langMap[ext] || 'text';

    res.json({ content, language });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/changes — pending git changes + affected services
// ---------------------------------------------------------------------------

router.get('/:id/changes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);

    const git = await getGit(repo.path);
    const statusResult = await git.status();
    const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];

    for (const f of statusResult.not_added) changedFiles.push({ path: f, status: 'new' });
    for (const f of statusResult.created) changedFiles.push({ path: f, status: 'new' });
    for (const f of statusResult.modified) changedFiles.push({ path: f, status: 'modified' });
    for (const f of statusResult.staged) {
      if (!changedFiles.some((cf) => cf.path === f)) changedFiles.push({ path: f, status: 'modified' });
    }
    for (const f of statusResult.deleted) changedFiles.push({ path: f, status: 'deleted' });

    const latest = readLatest(repo.path);
    const affectedServices: string[] = [];
    if (latest) {
      for (const svc of latest.graph.services) {
        const svcRoot = svc.rootPath;
        const isAffected = changedFiles.some(
          (cf) => cf.path.startsWith(svcRoot + '/') || cf.path === svcRoot,
        );
        if (isAffected) affectedServices.push(svc.id);
      }
    }

    res.json({ changedFiles, affectedServices });
  } catch (error) {
    next(error);
  }
});

export default router;
