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
 *           Generate the IL contracts from `corpus.json` on disk. Returns
 *           the extraction outcome (extracted / failed / skipped). Drives
 *           `spec:progress` / `spec:complete` socket events with
 *           `kind: 'generate'`.
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
import { loadSpec } from '@truecourse/core/lib/spec-store';
import { isGitRepo, getGit, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import { promotedContractPaths } from '@truecourse/core/lib/inferred-decisions';
import { diffContents } from '@truecourse/core/lib/artifact-diff';
import { baselineCommit } from './diff-base.js';
import {
  CORPUS_GENERATE_STEPS,
  generateFromCorpusInProcess,
  readGeneratedSummary,
  EstimateDeclined,
} from '@truecourse/core/commands/spec-in-process';
import {
  createSocketSpecTracker,
  createSocketSpecEstimateHandler,
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
  /** True when this authored contract was promoted from an inferred decision. */
  inferred?: boolean;
}

interface ContractModule {
  name: string;
  files: ContractFile[];
}

interface EffectiveFile {
  path: string;
  provenance: Provenance;
  inferred?: boolean;
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
    byModule.get(moduleName)!.push({ name, path: p, provenance: f.provenance, inferred: f.inferred });
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
 * The repo's EFFECTIVE contract files = its AUTHORED set UNIONed with the
 * workspace corpus it inherits, the repo winning on a relpath collision —
 * mirroring what the gate verifies. Each file is tagged with its layer for the
 * provenance badge. In OSS (no workspace org, file store) the workspace list is
 * empty, so this is repo-only.
 *
 * Inferred (`contracts_inferred`) is deliberately EXCLUDED — undocumented
 * decisions live on the Inferred tab, and only appear here once promoted into the
 * authored set. So the Contracts tab shows only documented/enforced contracts.
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
  if (commitSha && authored.length === 0) {
    // Head wasn't scanned (code-only PR) — no contracts stored at this commit.
    // Read the repo's latest stored set instead so the effective view is
    // base + workspace, not workspace-only.
    authored = await listContractFiles(repoKey, 'contracts');
  }
  const promoted = new Set(await promotedContractPaths(repoKey));
  const out: EffectiveFile[] = authored.map((path) => ({
    path,
    provenance: 'repo',
    inferred: promoted.has(path),
  }));
  if (workspaceOrgId) {
    const repoSet = new Set(authored);
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
      // `lastGenerate` (gaps + validation issues from the last run) is persisted to
      // the local repo only; absent → null (e.g. EE, or never generated).
      res.json({
        hasContracts: files.length > 0,
        modules: groupByModule(files),
        lastGenerate: readGeneratedSummary(repo.path),
      });
    } catch (e) {
      next(e);
    }
  },
);

// PR diff (EE): authored contracts the PR head adds / removes / modifies vs the
// default-branch baseline. Diffs the repo's OWN set by path + `.tc` content.
router.get(
  '/:id/contracts/diff',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const ref = refOf(req);
      if (!ref) {
        res.json({ added: [], removed: [], modified: [] });
        return;
      }
      const baseCommit = await baselineCommit(repo.path);
      const toMap = async (commit: string | undefined): Promise<Map<string, string>> => {
        const paths = commit ? await listContractFiles(repo.path, 'contracts', commit) : [];
        const entries = await Promise.all(
          paths.map(async (p) => [p, (await readContractFile(repo.path, 'contracts', p, commit)) ?? ''] as const),
        );
        return new Map(entries);
      };
      const baseMap = await toMap(baseCommit ?? undefined);
      // A code-only PR head regenerates NO spec/contracts (the gate reuses the base),
      // and may even carry a PARTIAL authored-contracts manifest from a reapplied
      // promotion — which would wrongly report the whole base as "removed". The
      // presence of a `corpus` artifact at the head is the "head regenerated" signal;
      // without it, use the base (head == base → no contract delta).
      const headRegenerated = (await loadSpec<unknown>({ repoKey: repo.path, commitSha: ref }, 'corpus')) != null;
      const headMap = headRegenerated ? await toMap(ref) : baseMap;
      const { added, removed, modified } = diffContents(baseMap, headMap);
      res.json({ added, removed, modified });
    } catch (e) {
      next(e);
    }
  },
);

// OSS Git-Diff: which AUTHORED `.tc` files the working tree adds / removes /
// modifies vs the last commit (git status on `.truecourse/contracts`). EE uses GET.
router.post(
  '/:id/contracts/diff',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      if (!(await isGitRepo(repo.path))) {
        res.status(400).json({ error: NOT_A_GIT_REPO_MESSAGE });
        return;
      }
      const git = await getGit(repo.path);
      const s = await git.status();
      const PREFIX = '.truecourse/contracts/';
      const authored = (f: string) =>
        f.startsWith(PREFIX) && f.endsWith('.tc') && !f.slice(PREFIX.length).startsWith('_inferred/');
      const rel = (f: string) => f.slice(PREFIX.length);
      const status = new Map<string, 'added' | 'removed' | 'modified'>();
      for (const f of s.deleted) if (authored(f)) status.set(rel(f), 'removed');
      for (const f of [...s.created, ...s.not_added]) if (authored(f)) status.set(rel(f), 'added');
      for (const f of [...s.modified, ...s.staged]) if (authored(f) && !status.has(rel(f))) status.set(rel(f), 'modified');
      const added: string[] = [];
      const removed: string[] = [];
      const modified: string[] = [];
      for (const [p, st] of status) (st === 'added' ? added : st === 'removed' ? removed : modified).push(p);
      res.json({ added, removed, modified });
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
        CORPUS_GENERATE_STEPS.map((s) => ({ ...s })),
      );

      const response: Record<string, unknown> = {};
      const { corpus } = await generateFromCorpusInProcess(repo.path, {
        tracker,
        source: 'dashboard',
        onLlmEstimate: createSocketSpecEstimateHandler(repoIdForCleanup),
      });
      if (corpus.kind === 'generated') {
        response.il = {
          written: corpus.result.write.written.length,
          gaps: corpus.result.gaps,
          validationIssues: corpus.result.validationIssues,
          mergeDiagnostics: corpus.result.mergeDiagnostics ?? [],
          // Unchanged corpus → skipped generation (0 LLM). The toaster shows
          // "nothing changed" instead of "wrote 0".
          noChanges: corpus.result.noChanges ?? false,
        };
      } else if (corpus.kind === 'failed') {
        response.il = { error: corpus.error.message };
      } else {
        response.il = { skipped: corpus.reason };
      }

      emitSpecComplete(repoIdForCleanup, 'generate');
      res.json(response);
    } catch (e) {
      // User declined the cost estimate — a clean cancel, not an error.
      if (e instanceof EstimateDeclined) {
        if (repoIdForCleanup) emitSpecComplete(repoIdForCleanup, 'generate');
        res.json({ il: { skipped: 'cancelled' } });
        return;
      }
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
