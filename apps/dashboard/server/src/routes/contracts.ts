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
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { listContractFiles, readContractFile } from '@truecourse/core/lib/contract-store';
import { isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
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
 * Group flat posix-relative `.tc` paths by their top-level segment (module),
 * matching how the writer lays out files. `_shared`/`_inferred`/`_unenforceable`
 * sort first — cross-cutting reference material the user wants at the top.
 */
function groupByModule(relPaths: string[]): ContractModule[] {
  const byModule = new Map<string, ContractFile[]>();
  for (const p of relPaths) {
    const slash = p.indexOf('/');
    const moduleName = slash === -1 ? p : p.slice(0, slash);
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (!byModule.has(moduleName)) byModule.set(moduleName, []);
    byModule.get(moduleName)!.push({ name, path: p });
  }
  const modules: ContractModule[] = [...byModule.entries()].map(([name, files]) => ({
    name,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }));
  modules.sort((a, b) => {
    const aLeading = a.name.startsWith('_') ? 0 : 1;
    const bLeading = b.name.startsWith('_') ? 0 : 1;
    if (aLeading !== bLeading) return aLeading - bLeading;
    return a.name.localeCompare(b.name);
  });
  return modules;
}

/** Authored + inferred files, with the inferred set surfaced under `_inferred/`. */
async function currentContractFiles(repoKey: string): Promise<string[]> {
  const authored = await listContractFiles(repoKey, 'contracts');
  const inferred = await listContractFiles(repoKey, 'contracts_inferred');
  return [...authored, ...inferred.map((p) => `_inferred/${p}`)];
}

const INFERRED_PREFIX = '_inferred/';

// ---------------------------------------------------------------------------
// GET /api/repos/:id/contracts/tree
// ---------------------------------------------------------------------------

router.get(
  '/:id/contracts/tree',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const files = await currentContractFiles(repo.path);
      res.json({ hasContracts: files.length > 0, modules: groupByModule(files) });
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const requested = String(req.query.path ?? '');
      if (!requested) {
        res.status(400).json({ error: 'Missing `path` query parameter.' });
        return;
      }
      // `_inferred/` paths come from the split `contracts_inferred` kind; the
      // store rejects traversal (a path not in its manifest/tree returns null).
      const content = requested.startsWith(INFERRED_PREFIX)
        ? await readContractFile(repo.path, 'contracts_inferred', requested.slice(INFERRED_PREFIX.length))
        : await readContractFile(repo.path, 'contracts', requested);
      if (content === null) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      res.json({ path: requested, content });
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
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      if (!(await isGitRepo(repo.path))) {
        res.status(400).json({ error: NOT_A_GIT_REPO_MESSAGE });
        return;
      }
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        GENERATE_STEPS.map((s) => ({ ...s })),
      );
      const outcome = await generateContractsInProcess(repo.path, { tracker, source: 'dashboard' });

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
