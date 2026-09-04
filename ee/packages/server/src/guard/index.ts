/**
 * Guard router (protected — behind the enterprise auth gate). The manual hosted
 * "Generate" trigger: `POST /api/ee/guard/generate` enqueues the same
 * single-flight `repo.guard` job the baseline onboarding chain uses. The client
 * sends only the repo identifier; installation, default branch, and the commit
 * to persist under are resolved server-side from the stored gate records — the
 * BASELINE commit, the repo's default-branch view of record (the same commit the
 * spec corpus was scanned at), never a client-supplied SHA.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '@truecourse/shared';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';
import {
  splitRepo,
  getPullRequest,
  buildGuardSpecRegenRequest,
  type GateStore,
  type OctokitClient,
} from '@truecourse/ee-github-app';
import type {
  GuardGenerateEnqueueRequest,
  GuardSpecRegenEnqueueRequest,
} from '../jobs/constants.js';

function orgIdOf(req: Request): string | null {
  return (req as Request & { user?: AuthUser }).user?.organizationId ?? null;
}

export interface GuardRouterDeps {
  /** The gate store — resolves the connected repo link + its baseline commit. */
  store: Pick<GateStore, 'getRepo' | 'getBaseline'>;
  /** Single-flight guard-generate enqueue (null = already running). */
  enqueueGuardGenerate(req: GuardGenerateEnqueueRequest): Promise<string | null>;
}

const generateSchema = z.object({ repoFullName: z.string().min(1) });

async function handleGenerate(deps: GuardRouterDeps, req: Request, res: Response): Promise<void> {
  const org = orgIdOf(req);
  if (!org) {
    res.status(401).json({ error: 'no workspace' });
    return;
  }
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    return;
  }
  const { repoFullName } = parsed.data;

  // Ownership: only a repo connected to the caller's workspace. 404 (not 403)
  // so another tenant can't probe which repos are connected elsewhere.
  const link = await deps.store.getRepo(repoFullName);
  if (!link || link.workspaceOrgId !== org) {
    res.status(404).json({ error: 'repo not connected' });
    return;
  }

  // Scenarios persist under the repo's baseline commit (where the corpus was
  // scanned). No baseline yet ⇒ the initial scan hasn't finished — nothing to
  // generate against, and no commit to key by.
  const baseline = await deps.store.getBaseline(repoFullName);
  if (!baseline) {
    res.status(409).json({
      error: 'Repository has not been scanned yet — wait for the initial scan to finish.',
    });
    return;
  }

  // Fail loudly up front: generation needs the LLM. Checked here, before
  // enqueue, so a missing provider is a synchronous 409 — not a failed job.
  if (!isLlmConfigured()) {
    res.status(409).json({ error: NO_LLM_PROVIDER_MESSAGE });
    return;
  }

  const jobId = await deps.enqueueGuardGenerate({
    repoFullName,
    installationId: link.installationId,
    defaultBranch: link.defaultBranch,
    commitSha: baseline.commitSha,
    workspaceOrgId: org,
  });
  if (jobId === null) {
    res.status(409).json({ error: 'Guard generation is already running for this repository.' });
    return;
  }
  res.status(202).json({ jobId });
}

export function createGuardRouter(deps: GuardRouterDeps): Router {
  const router = Router();

  router.post('/generate', async (req: Request, res: Response) => {
    // Express 4 doesn't catch async rejections: without this, a thrown enqueue
    // (e.g. the job worker never started — the router mounts unconditionally
    // while the worker is best-effort) would hang the request instead of
    // answering with the failure.
    try {
      await handleGenerate(deps, req, res);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

/**
 * Build the `repoKey → enqueue` seam the dashboard installs via
 * `setGuardGenerateEnqueue`. A repo-scope decision that clears the last spec
 * conflict fires this so a generate that had stalled BLOCKED on that conflict
 * finally authors its scenarios.
 *
 * Resolution is the SAME as the manual "Generate" router (installation, default
 * branch, baseline commit, workspace org — all from the stored gate records),
 * minus the request org: there is no HTTP request here, so the org is the link's
 * own `workspaceOrgId`. Best-effort — silently no-ops when the repo isn't
 * connected or has no baseline yet; the single-flight key makes a redundant
 * enqueue (a generate already running) a harmless null.
 */
export function createGuardGenerateEnqueue(deps: GuardRouterDeps): (repoKey: string) => Promise<void> {
  return async (repoKey: string): Promise<void> => {
    const link = await deps.store.getRepo(repoKey);
    if (!link?.workspaceOrgId) return;
    const baseline = await deps.store.getBaseline(repoKey);
    if (!baseline) return;
    await deps.enqueueGuardGenerate({
      repoFullName: repoKey,
      installationId: link.installationId,
      defaultBranch: link.defaultBranch,
      commitSha: baseline.commitSha,
      workspaceOrgId: link.workspaceOrgId,
    });
  };
}

export interface GuardPrRegenDeps {
  /** The gate store — resolves the connected repo link (installation + org). */
  store: Pick<GateStore, 'getRepo'>;
  /** Installation-scoped GitHub client — resolves the LIVE pull request. */
  octokitFor: (installationId: number) => OctokitClient;
  /** Single-flight spec-regen enqueue (null = one already running for that head). */
  enqueueGuardSpecRegen(req: GuardSpecRegenEnqueueRequest): Promise<string | null>;
}

/**
 * Build the `(repoKey, pr) → enqueue` seam the dashboard installs via
 * `setGuardPrRegenEnqueue` — the PR analog of {@link createGuardGenerateEnqueue}.
 * A PR-scoped dismissal that suppresses the PR's last active finding fires this
 * so the PR head's scenarios regenerate honoring the dismissals overlay.
 *
 * The job is the SAME durable `guard.spec-regen` the PR's spec-change checkbox
 * enqueues, minus the checkbox comment to settle (`commentId: null`) — assembled
 * by the shared `buildGuardSpecRegenRequest` so the two triggers can't drift. The
 * live PR (base/head/fork) is resolved from GitHub — the same resolution the
 * checkbox handler uses — so the regen targets the CURRENT head even when the
 * gate records lag a push. Best-effort: silently no-ops when the repo isn't
 * connected or its gate is disabled (the checkbox path's rule — this job
 * re-gates the PR); the single-flight key makes a redundant enqueue (a regen
 * already running for that head) a harmless null.
 */
export function createGuardPrRegenEnqueue(
  deps: GuardPrRegenDeps,
): (repoKey: string, pr: number) => Promise<void> {
  return async (repoKey: string, prNumber: number): Promise<void> => {
    const link = await deps.store.getRepo(repoKey);
    if (!link?.enabled || !link.workspaceOrgId) return;
    const octokit = deps.octokitFor(link.installationId);
    const pr = await getPullRequest(octokit, splitRepo(repoKey), prNumber);
    await deps.enqueueGuardSpecRegen(
      buildGuardSpecRegenRequest({ repoFullName: repoKey, link, prNumber, pr, commentId: null }),
    );
  };
}
