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
import type { AuthUser } from '@truecourse/shared';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  listContractFiles,
  readContractFile,
  listWorkspaceContractFiles,
  readWorkspaceContractFile,
} from '@truecourse/core/lib/contract-store';
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

/** Which layer a contract came from — `workspace` is inherited (enterprise). */
type Provenance = 'workspace' | 'repo';

interface ContractFile {
  name: string;
  /** Relative to the contracts root (e.g. `orders/operations/get-api-orders.tc`). */
  path: string;
  /** `workspace` for an inherited contract; `repo` (or absent) for the repo's own. */
  provenance?: Provenance;
}

interface ContractModule {
  name: string;
  files: ContractFile[];
}

interface EffectiveFile {
  path: string;
  provenance: Provenance;
}

/**
 * Group flat posix-relative `.tc` paths by their top-level segment (module),
 * matching how the writer lays out files. `_shared`/`_inferred`/`_unenforceable`
 * sort first — cross-cutting reference material the user wants at the top.
 */
function groupByModule(files: EffectiveFile[]): ContractModule[] {
  const byModule = new Map<string, ContractFile[]>();
  for (const f of files) {
    const p = f.path;
    const slash = p.indexOf('/');
    const moduleName = slash === -1 ? p : p.slice(0, slash);
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (!byModule.has(moduleName)) byModule.set(moduleName, []);
    byModule.get(moduleName)!.push({ name, path: p, provenance: f.provenance });
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

/**
 * The repo's EFFECTIVE contract files = its own (authored + inferred) UNIONed
 * with the workspace corpus it inherits, the repo winning on a relpath collision
 * — mirroring what the gate verifies. Each file is tagged with its layer for the
 * provenance badge. In OSS (no workspace org, file store) the workspace list is
 * empty, so this is repo-only and unchanged.
 *
 * Ref fallback: a CODE-ONLY PR head has NO stored repo contracts at its commit
 * (the gate reuses the base's contracts for code-only PRs — #64), so the
 * per-commit list comes back empty. Rather than collapse the repo layer to
 * empty (which would make the Contracts tab show WORKSPACE-only), fall back to
 * the repo's LATEST stored set (the base / main's). Net effect = base ∪
 * workspace for code-only PRs, and the head's OWN contracts for spec-changing
 * PRs (which DID get scanned at head, so the per-commit set is non-empty).
 */
export async function effectiveContractFiles(
  repoKey: string,
  workspaceOrgId: string | undefined,
  commitSha?: string,
): Promise<EffectiveFile[]> {
  let authored = await listContractFiles(repoKey, 'contracts', commitSha);
  let inferred = await listContractFiles(repoKey, 'contracts_inferred', commitSha);
  if (commitSha && authored.length === 0 && inferred.length === 0) {
    // Head wasn't scanned (code-only PR) — no contracts stored at this commit.
    // Read the repo's latest stored set instead so the effective view is
    // base + workspace, not workspace-only.
    authored = await listContractFiles(repoKey, 'contracts');
    inferred = await listContractFiles(repoKey, 'contracts_inferred');
  }
  const repoPaths = [...authored, ...inferred.map((p) => `${INFERRED_PREFIX}${p}`)];
  const out: EffectiveFile[] = repoPaths.map((path) => ({ path, provenance: 'repo' }));
  if (workspaceOrgId) {
    const repoSet = new Set(repoPaths);
    const ws = await listWorkspaceContractFiles({ workspaceOrgId }, 'contracts');
    for (const path of ws) {
      if (!repoSet.has(path)) out.push({ path, provenance: 'workspace' });
    }
  }
  return out;
}

/** Optional `?ref=<commit>` — the dashboard ref switcher (EE). Empty ⇒ latest. */
function refOf(req: Request): string | undefined {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  return ref || undefined;
}

/** The signed-in workspace org (enterprise), set by the auth gate. Absent in OSS. */
function workspaceOrgOf(req: Request): string | undefined {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? undefined;
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
      const files = await effectiveContractFiles(repo.path, workspaceOrgOf(req), refOf(req));
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
      const ref = refOf(req);
      let content: string | null;
      if (requested.startsWith(INFERRED_PREFIX)) {
        const rel = requested.slice(INFERRED_PREFIX.length);
        content = await readContractFile(repo.path, 'contracts_inferred', rel, ref);
        // Code-only PR head has no contracts stored at `ref` (the effective
        // tree fell back to the base set) — read the latest stored file too.
        if (content === null && ref) {
          content = await readContractFile(repo.path, 'contracts_inferred', rel);
        }
      } else {
        // Prefer the repo's own file; fall back to the inherited workspace
        // contract (enterprise) for a `provenance: 'workspace'` entry.
        content = await readContractFile(repo.path, 'contracts', requested, ref);
        // Code-only PR head has no contracts stored at `ref` (the effective
        // tree fell back to the base set) — read the latest stored file too.
        if (content === null && ref) {
          content = await readContractFile(repo.path, 'contracts', requested);
        }
        const org = workspaceOrgOf(req);
        if (content === null && org) {
          content = await readWorkspaceContractFile({ workspaceOrgId: org }, 'contracts', requested);
        }
      }
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
