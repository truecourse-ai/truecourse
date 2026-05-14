/**
 * Contracts routes — the dashboard surface for browsing + producing IL
 * contracts (Module 2).
 *
 *   GET   /api/repos/:id/contracts/tree
 *           Walk `.truecourse/contracts/` and return the file tree
 *           grouped by module. Pure read, no LLM.
 *
 *   GET   /api/repos/:id/contracts/file?path=...
 *           Return one .tc file's content. Refuses path traversal.
 *
 *   POST  /api/repos/:id/contracts/generate
 *           Run `generateContractsInProcess` against the canonical spec
 *           on disk. Returns the IL extraction outcome (extracted /
 *           failed / skipped). Drives `spec:progress` / `spec:complete`
 *           socket events with `kind: 'generate'`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  GENERATE_STEPS,
  generateContractsInProcess,
} from '@truecourse/core/commands/spec-in-process';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

const CONTRACTS_REL = path.join('.truecourse', 'contracts');

function contractsRoot(repoPath: string): string {
  return path.join(repoPath, CONTRACTS_REL);
}

interface ContractFile {
  name: string;
  /** Relative to the contracts root (e.g. `orders/operations/get-api-orders.tc`). */
  path: string;
}

interface ContractModule {
  name: string;
  files: ContractFile[];
}

/**
 * Walk the contracts dir one level deep. Each top-level entry is a
 * module (or `_shared`, `_unenforceable`); files under it are
 * recursively included with their relative path preserved. We keep
 * the layout flat-by-module so the sidebar matches how the writer
 * actually lays out files.
 */
function walkContracts(rootPath: string): ContractModule[] {
  if (!fs.existsSync(rootPath)) return [];
  const modules: ContractModule[] = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const moduleName = entry.name;
    const moduleDir = path.join(rootPath, moduleName);
    const files: ContractFile[] = [];
    collectTcFiles(moduleDir, rootPath, files);
    files.sort((a, b) => a.path.localeCompare(b.path));
    modules.push({ name: moduleName, files });
  }
  modules.sort((a, b) => sortModule(a.name).localeCompare(sortModule(b.name)));
  return modules;
}

/**
 * Sort key for modules. `_shared` and `_unenforceable` (leading
 * underscore) get pushed to the end so user modules sort first.
 */
function sortModule(name: string): string {
  return name.startsWith('_') ? `￿${name}` : name;
}

function collectTcFiles(dir: string, contractsRoot: string, out: ContractFile[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTcFiles(abs, contractsRoot, out);
    } else if (entry.isFile() && entry.name.endsWith('.tc')) {
      out.push({
        name: entry.name,
        path: path.relative(contractsRoot, abs).replace(/\\/g, '/'),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/repos/:id/contracts/tree
// ---------------------------------------------------------------------------

router.get(
  '/:id/contracts/tree',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const root = contractsRoot(repo.path);
      const modules = walkContracts(root);
      const fileCount = modules.reduce((acc, m) => acc + m.files.length, 0);
      res.json({
        hasContracts: fileCount > 0,
        modules,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/contracts/file?path=...
// ---------------------------------------------------------------------------

router.get(
  '/:id/contracts/file',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const root = contractsRoot(repo.path);
      const requested = String(req.query.path ?? '');
      if (!requested) {
        res.status(400).json({ error: 'Missing `path` query parameter.' });
        return;
      }
      const resolved = path.resolve(root, requested);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        res.status(400).json({ error: 'Path outside contracts root.' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      res.json({ path: requested, content: fs.readFileSync(resolved, 'utf-8') });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/contracts/generate — run IL extraction
// ---------------------------------------------------------------------------

router.post(
  '/:id/contracts/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        GENERATE_STEPS.map((s) => ({ ...s })),
      );
      const outcome = await generateContractsInProcess(repo.path, { tracker });

      const response: Record<string, unknown> = {};
      if (outcome.il.kind === 'extracted') {
        response.il = {
          written: outcome.il.result.write.written.length,
          validationIssues: outcome.il.result.validationIssues,
          mergeDiagnostics: outcome.il.result.mergeDiagnostics,
        };
      } else if (outcome.il.kind === 'failed') {
        response.il = { error: outcome.il.error.message };
      } else {
        response.il = { skipped: outcome.il.reason };
      }

      emitSpecComplete(repoIdForCleanup, 'generate');
      res.json(response);
    } catch (e) {
      if (repoIdForCleanup) {
        emitSpecProgress(repoIdForCleanup, {
          step: 'error',
          percent: 100,
          detail: (e as Error).message,
        });
      }
      next(e);
    }
  },
);

export default router;
