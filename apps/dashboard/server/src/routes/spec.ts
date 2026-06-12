/**
 * Spec Consolidation routes — the dashboard surface for Module 1.
 *
 *   GET   /api/repos/:id/spec/scan-state
 *           Read the persisted scan-state.json. Returns 404 if no
 *           scan has been run yet — the dashboard then shows the
 *           "Run scan" empty state. Cheap; no LLM calls.
 *
 *   GET   /api/repos/:id/spec/scan
 *           Run consolidate(), persist the result to scan-state.json,
 *           and return it. This is the explicit "rescan now" path.
 *
 *   GET   /api/repos/:id/spec/decisions
 *           Read decisions.json. Returns the empty default if absent.
 *
 *   POST  /api/repos/:id/spec/decisions
 *           Body: { conflictId, resolution, candidateFingerprint }
 *           Upsert a single decision. Existing decision for the same
 *           conflictId is replaced. Persists to decisions.json. The
 *           caller follows up with GET /spec/scan to refresh state.
 *
 *   POST  /api/repos/:id/spec/decisions/batch
 *           Body: { mode: 'all-defaults' }
 *           Convenience: accept the engine's pre-pick on every
 *           currently-open conflict in one shot.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  claimsFilePath,
  type ClaimsFile,
  type Resolution,
} from '@truecourse/spec-consolidator';
import type { AuthUser } from '@truecourse/shared';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  loadSpec,
  loadLatestSpec,
  loadWorkspaceSpec,
  specsMaterializeInPlace,
} from '@truecourse/core/lib/spec-store';
import { listContractFiles, contractsMaterializeInPlace } from '@truecourse/core/lib/contract-store';
import { readVerifyLatest } from '@truecourse/core/lib/verify-store';
import { isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import {
  addManualChain,
  addManualInclude,
  generatedMarkerPath,
  getDecisions,
  getScanState,
  removeManualChain,
  removeManualInclude,
  resolveAllDefaultsInProcess,
  resolveAllDefaultsRemerge,
  refreshRepoCanonicalSpec,
  regenerateRepoContractsFromDecisions,
  revokeDecision as revokeDecisionInProcess,
  SCAN_STEPS,
  scanInProcess,
  upsertDecision,
  verifyLatestPath,
} from '@truecourse/core/commands/spec-in-process';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';
import { log } from '@truecourse/core/lib/logger';
import { getBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';

const router: Router = Router();

function orgOf(req: Request): string | undefined {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? undefined;
}

/**
 * After a HOSTED repo decision (the OSS local flow re-runs the on-demand Scan):
 *
 *  1. SYNCHRONOUSLY re-merge + persist the canonical `claims` + `scan-state` —
 *     fast (no docs/git/LLM), so the Spec view reflects the decision immediately.
 *  2. Defer the slow `.tc` contract regen to the background queue (off the request
 *     path); inline best-effort when no queue is wired (tests).
 *
 * Both steps are best-effort — a failure never fails the decision (the spec
 * re-merges on read regardless, and contracts refresh on the next scan). No-op on
 * the OSS file edition.
 */
async function refreshHostedContracts(repoKey: string, org: string | undefined): Promise<void> {
  if (specsMaterializeInPlace()) return;
  try {
    await refreshRepoCanonicalSpec(repoKey);
  } catch (e) {
    log.warn(`[spec] spec refresh after decision failed (${repoKey}): ${(e as Error).message}`);
  }
  const enqueue = getBackgroundTaskRunner();
  if (enqueue && org) {
    try {
      await enqueue({ type: 'repo.contracts', workspaceOrgId: org, repoKey });
    } catch (e) {
      log.warn(`[spec] enqueue contract refresh failed (${repoKey}): ${(e as Error).message}`);
    }
    return;
  }
  try {
    await regenerateRepoContractsFromDecisions(repoKey);
  } catch (e) {
    log.warn(`[spec] contract refresh after decision failed (${repoKey}): ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/scan
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/scan-state',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const state = await getScanState(repo.path);
      if (!state) {
        res.status(404).json({ error: 'No scan has been run yet.' });
        return;
      }
      res.json(state);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/spec/scan',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      if (!(await isGitRepo(repo.path))) {
        res.status(400).json({ error: NOT_A_GIT_REPO_MESSAGE });
        return;
      }
      const tracker = createSocketSpecTracker(repoIdForCleanup, SCAN_STEPS.map((s) => ({ ...s })));
      const { scanState } = await scanInProcess(repo.path, { tracker, source: 'dashboard' });
      emitSpecComplete(repoIdForCleanup, 'scan');
      res.json(scanState);
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

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/decisions
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/decisions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      res.json(await getDecisions(repo.path));
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/decisions  — upsert one decision
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/decisions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as {
        conflictId?: string;
        resolution?: Resolution;
        candidateFingerprint?: string;
        note?: string;
      };
      if (!body.conflictId || !body.resolution || !body.candidateFingerprint) {
        res.status(400).json({
          error: 'Missing conflictId, resolution, or candidateFingerprint.',
        });
        return;
      }
      const next = await upsertDecision(repo.path, {
        conflictId: body.conflictId,
        resolution: body.resolution,
        candidateFingerprint: body.candidateFingerprint,
        note: body.note,
      });
      await refreshHostedContracts(repo.path, orgOf(req));
      res.json(next);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/spec/decisions/:conflictId — revoke one decision
// ---------------------------------------------------------------------------

router.delete(
  '/:id/spec/decisions/:conflictId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const conflictId = req.params.conflictId as string;
      const nextFile = await revokeDecisionInProcess(repo.path, conflictId);
      await refreshHostedContracts(repo.path, orgOf(req));
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/chains/manual — mark older doc as superseded by newer
// DELETE /api/repos/:id/spec/chains/manual — revoke a manual chain
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/chains/manual',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { older?: string; newer?: string; note?: string };
      if (!body.older || !body.newer) {
        res.status(400).json({ error: 'Missing older or newer doc path.' });
        return;
      }
      if (body.older === body.newer) {
        res.status(400).json({ error: 'older and newer must be different docs.' });
        return;
      }
      const nextFile = await addManualChain(repo.path, {
        older: body.older,
        newer: body.newer,
        note: body.note,
      });
      await refreshHostedContracts(repo.path, orgOf(req));
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST   /api/repos/:id/spec/docs/include  — force-include a skipped doc
// DELETE /api/repos/:id/spec/docs/include  — remove a manual-include override
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/docs/include',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { path?: string };
      if (!body.path) {
        res.status(400).json({ error: 'Missing doc path.' });
        return;
      }
      const nextFile = await addManualInclude(repo.path, body.path);
      await refreshHostedContracts(repo.path, orgOf(req));
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/docs/include',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { path?: string };
      if (!body.path) {
        res.status(400).json({ error: 'Missing doc path.' });
        return;
      }
      const nextFile = await removeManualInclude(repo.path, body.path);
      await refreshHostedContracts(repo.path, orgOf(req));
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/chains/manual',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { older?: string; newer?: string };
      if (!body.older || !body.newer) {
        res.status(400).json({ error: 'Missing older or newer doc path.' });
        return;
      }
      const nextFile = await removeManualChain(repo.path, { older: body.older, newer: body.newer });
      await refreshHostedContracts(repo.path, orgOf(req));
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/decisions/batch — accept all defaults
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/decisions/batch',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const mode = (req.body as { mode?: string } | undefined)?.mode;
      if (mode !== 'all-defaults') {
        res.status(400).json({ error: 'Only mode="all-defaults" is supported.' });
        return;
      }
      // Hosted (stored sets, no working tree): re-merge from the persisted raw
      // claims + chains rather than re-consolidating from docs we don't have —
      // git-free, mirroring the workspace accept-all.
      if (!specsMaterializeInPlace()) {
        const postScanState = await resolveAllDefaultsRemerge(repo.path);
        await refreshHostedContracts(repo.path, orgOf(req));
        res.json({ postScanState });
        return;
      }
      // OSS local: same code path as the CLI's `spec resolve --all-defaults`.
      // Persists decisions.json and refreshes scan-state.json so the
      // dashboard's next mount sees the updated conflict picture.
      const result = await resolveAllDefaultsInProcess(repo.path);
      res.json({ added: result.additions, decisions: result.decisions });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/staleness
//
// Cheap mtime probe powering the amber dots on Generate / Verify.
//
//   contractsStale  claims.json is newer than the last generate marker
//                   (or the marker is missing → never generated against
//                   the current claim set)
//   verifyStale     last generate marker is newer than verifier/LATEST.json
//                   (or LATEST.json is missing → never verified against
//                   current contracts). The verifier store's LATEST.json is
//                   its own marker; `verifyInProcess` rewrites it on every
//                   successful run.
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/staleness',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);

      // EE (stored sets, not the live tree): there are no local marker files to
      // stat, and the gate produces spec → contracts → verify TOGETHER per
      // commit, so the latest stored sets are always in sync. Report existence
      // from the stores; nothing is stale.
      if (!contractsMaterializeInPlace()) {
        const [claims, contractFiles, verify] = await Promise.all([
          loadLatestSpec<unknown>(repo.path, 'claims'),
          listContractFiles(repo.path, 'contracts'),
          readVerifyLatest(repo.path),
        ]);
        res.json({
          contractsStale: false,
          verifyStale: false,
          hasClaims: claims !== null,
          hasGenerated: contractFiles.length > 0,
          hasVerified: verify !== null,
        });
        return;
      }

      // OSS: cheap mtime probe (the IL writers stamp files in place, and the
      // scan/generate/verify steps run independently, so they can drift).
      const claimsMtime = mtimeIfExists(claimsFilePath(repo.path));
      const generatedMtime = mtimeIfExists(generatedMarkerPath(repo.path));
      // Verifier store's LATEST.json is the verify marker (its own write stamp).
      const verifiedMtime = mtimeIfExists(verifyLatestPath(repo.path));

      const contractsStale =
        claimsMtime !== null &&
        (generatedMtime === null || claimsMtime > generatedMtime);
      const verifyStale =
        generatedMtime !== null &&
        (verifiedMtime === null || generatedMtime > verifiedMtime);

      res.json({
        contractsStale,
        verifyStale,
        hasClaims: claimsMtime !== null,
        hasGenerated: generatedMtime !== null,
        hasVerified: verifiedMtime !== null,
      });
    } catch (e) {
      next(e);
    }
  },
);

function mtimeIfExists(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** The latest claim set, or a specific commit's when `?ref=<commit>` is given
 *  (the EE ref switcher — default branch vs a PR head). OSS ignores `ref`.
 *
 *  Ref fallback: a CODE-ONLY PR head has NO stored repo spec at its commit (the
 *  gate reuses the base's spec for code-only PRs — #64), so the per-commit load
 *  returns null. Rather than collapse the repo layer to empty (which would make
 *  the Spec tab show WORKSPACE-only), fall back to the repo's LATEST stored
 *  claims (the base / main's). Net effect = base ∪ workspace for code-only PRs,
 *  and the head's OWN spec for spec-changing PRs (which DID get scanned at head).
 */
async function claimsFor(repoKey: string, req: Request): Promise<ClaimsFile | null> {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  if (!ref) return loadLatestSpec<ClaimsFile>(repoKey, 'claims');
  const atRef = await loadSpec<ClaimsFile>({ repoKey, commitSha: ref }, 'claims');
  if (atRef) return atRef;
  return loadLatestSpec<ClaimsFile>(repoKey, 'claims');
}

/** The signed-in workspace org (enterprise), set by the auth gate. Absent in OSS. */
function workspaceOrgOf(req: Request): string | undefined {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? undefined;
}

type SpecLayer = 'workspace' | 'repo';
type ClaimEntry = ClaimsFile['claims'][number];
type LayeredClaim = ClaimEntry & { layer: SpecLayer };

interface EffectiveClaims {
  generatedAt: string;
  modules: ClaimsFile['modules'];
  claims: LayeredClaim[];
}

/** A claim's logical identity within the canonical set (for cross-layer dedupe). */
function claimKey(c: ClaimEntry): string {
  return `${c.module} ${c.topic} ${c.subject}`;
}

/**
 * A repo's EFFECTIVE canonical claims = its own UNIONed with the workspace
 * claims it inherits, the repo winning on a `(module, topic, subject)` collision,
 * each claim tagged with its layer for the provenance badge. Repo-only in OSS
 * (no workspace org / the file store returns null for the workspace artifact) —
 * mirrors the Contracts-tab merge, but at the claim level (claims are additive
 * context, so it's a union; the gate verifies contracts, not claims).
 */
export async function effectiveClaims(
  repoKey: string,
  workspaceOrgId: string | undefined,
  req: Request,
): Promise<EffectiveClaims | null> {
  const repo = await claimsFor(repoKey, req);
  const ws = workspaceOrgId
    ? await loadWorkspaceSpec<ClaimsFile>({ workspaceOrgId }, 'claims')
    : null;
  if (!repo && !ws) return null;

  const seen = new Set<string>();
  const claims: LayeredClaim[] = [];
  for (const c of repo?.claims ?? []) {
    claims.push({ ...c, layer: 'repo' });
    seen.add(claimKey(c));
  }
  for (const c of ws?.claims ?? []) {
    if (!seen.has(claimKey(c))) claims.push({ ...c, layer: 'workspace' });
  }

  // Module manifests: repo wins on a name collision; union the rest.
  const modulesByName = new Map<string, ClaimsFile['modules'][number]>();
  for (const m of ws?.modules ?? []) modulesByName.set(m.name, m);
  for (const m of repo?.modules ?? []) modulesByName.set(m.name, m);

  return {
    generatedAt: repo?.generatedAt ?? ws?.generatedAt ?? new Date().toISOString(),
    modules: [...modulesByName.values()],
    claims,
  };
}

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/canonical/tree
// GET /api/repos/:id/spec/canonical/section?module=…&topic=…
// ---------------------------------------------------------------------------

/**
 * Enumerate the canonical claim set under `.truecourse/specs/claims.json`.
 * Returns:
 *   - whether the file exists
 *   - per-module manifests, each carrying the list of `(topic, claimCount)`
 *     pairs the user can drill into
 *
 * Pure file-system read, no LLM, no consolidation.
 */
router.get(
  '/:id/spec/canonical/tree',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const claims = await effectiveClaims(repo.path, workspaceOrgOf(req), req);
      if (!claims) {
        res.json({ hasCanonical: false, modules: [] });
        return;
      }
      // Per (module, topic): claim count + how many are the repo's own, so a
      // topic/module that is ENTIRELY inherited from the workspace is badged.
      const agg = new Map<string, Map<string, { count: number; repo: number }>>();
      for (const c of claims.claims) {
        const byTopic = agg.get(c.module) ?? new Map<string, { count: number; repo: number }>();
        const t = byTopic.get(c.topic) ?? { count: 0, repo: 0 };
        t.count += 1;
        if (c.layer === 'repo') t.repo += 1;
        byTopic.set(c.topic, t);
        agg.set(c.module, byTopic);
      }
      const modules = claims.modules
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((manifest) => {
          const topics = [...(agg.get(manifest.name) ?? new Map<string, { count: number; repo: number }>()).entries()]
            .map(([topic, t]) => ({ topic, claimCount: t.count, inherited: t.repo === 0 }))
            .sort((a, b) => a.topic.localeCompare(b.topic));
          const inherited = topics.length > 0 && topics.every((t) => t.inherited);
          return { name: manifest.name, manifest, inherited, topics };
        });
      res.json({
        hasCanonical: true,
        generatedAt: claims.generatedAt,
        modules,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/spec/canonical/section',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const moduleName = String(req.query.module ?? '');
      const topic = String(req.query.topic ?? '');
      if (!moduleName || !topic) {
        res.status(400).json({ error: 'Missing `module` or `topic` query parameter.' });
        return;
      }
      const claims = await effectiveClaims(repo.path, workspaceOrgOf(req), req);
      if (!claims) {
        res.status(404).json({ error: 'No canonical spec yet — run scan first.' });
        return;
      }
      const manifest = claims.modules.find((m) => m.name === moduleName);
      if (!manifest) {
        res.status(404).json({ error: `Module ${moduleName} not found.` });
        return;
      }
      // Each claim carries `layer` ('workspace' | 'repo') for the provenance badge.
      const items = claims.claims
        .filter((c) => c.module === moduleName && c.topic === topic)
        .sort((a, b) => a.subject.localeCompare(b.subject));
      res.json({ module: moduleName, topic, manifest, claims: items });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
