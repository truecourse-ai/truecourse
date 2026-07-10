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
import type { GateStore } from '@truecourse/ee-github-app';
import type { GuardGenerateEnqueueRequest } from '../jobs/constants.js';

function orgIdOf(req: Request): string | null {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? null;
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
