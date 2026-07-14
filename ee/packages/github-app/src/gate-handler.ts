/**
 * The gate: runs automatically on every PR event (no checkbox), deterministically.
 * Analyzes the PR head vs the repo's baseline analysis, posts an authoritative
 * GitHub Code Quality Check (blocking or advisory per repo config), then — isolated
 * so a failure can't downgrade the Check — posts/refreshes a summary comment and
 * records the run.
 */

import { randomUUID } from 'node:crypto';
import { log } from '@truecourse/core/lib/logger';
import type { GateStore } from './store/types.js';
import type { GithubAuth } from './github.js';
import type { PullRequestPayload } from './webhook.js';
import {
  splitRepo,
  postCheck,
  startCheck,
  findComment,
  createComment,
  updateComment,
  type OctokitClient,
} from './octokit.js';
import { decideCodeQuality, type GateSeverity } from './gate.js';
import {
  GATE_MARKER,
  CODE_QUALITY_CHECK_NAME,
  renderGateComment,
  cqCheckOutput,
} from './gate-comment.js';
import {
  runGateVerify,
  type GateVerifyDeps,
  type GateVerifyRequest,
  type GateVerifyOutput,
} from './gate-runner.js';
import { prCodeQualityUrl } from './links.js';

const GATE_ACTIONS = ['opened', 'synchronize', 'reopened'];

export interface GateHandlerDeps {
  store: GateStore;
  auth: GithubAuth;
  /** Dashboard base URL, for the "view Code Quality" deep link. */
  appUrl?: string;
  octokitFor: (installationId: number) => OctokitClient;
  /** Injectable check runner (defaults to the real clone+analyze). */
  runVerify?: (
    deps: GateVerifyDeps,
    req: GateVerifyRequest,
  ) => Promise<GateVerifyOutput>;
  /** Min severity that fails the Code Quality Check (defaults to the repo config). */
  minSeverity?: GateSeverity;
  /** In-flight guard keyed by `${repo}#${headSha}` (concurrent deliveries). */
  gateInFlight?: Set<string>;
  /** Per-workspace LLM-code-analysis toggle reader; injected by the server, defaults off. */
  codeAnalysisLlm?: (orgId: string) => Promise<boolean>;
}

export async function handlePullRequestGate(
  deps: GateHandlerDeps,
  payload: PullRequestPayload,
): Promise<void> {
  if (!GATE_ACTIONS.includes(payload.action)) return;
  if (!payload.installation) return;
  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  const coords = splitRepo(repoFullName);
  const octokit = deps.octokitFor(payload.installation.id);
  const prNumber = payload.number;
  const eventHeadSha = payload.pull_request.head.sha;
  const installationId = payload.installation.id;
  const baseBranch = payload.pull_request.base.ref || link.defaultBranch;

  // Idempotency: skip a head sha we already gated (webhook redelivery), and
  // guard concurrent deliveries of the same sha.
  const flightKey = `${repoFullName}#${eventHeadSha}`;
  if (deps.gateInFlight?.has(flightKey)) return;
  const priorRuns = await deps.store.listRuns(repoFullName, 50);
  if (priorRuns.some((r) => r.headSha === eventHeadSha)) return;
  deps.gateInFlight?.add(flightKey);

  // Open the Check as "in progress" so the PR shows it running while the gate
  // works (clone + analyze can take a while). Completed in the paths below; the
  // `finally` is a safety net so a crash never leaves a Check running.
  const cqCheckId = await startCheck(octokit, coords, CODE_QUALITY_CHECK_NAME, eventHeadSha);
  let cqDone = false;

  try {
    const enableLlmAnalysis = link.workspaceOrgId
      ? (await deps.codeAnalysisLlm?.(link.workspaceOrgId)) ?? false
      : false;

    const runVerify = deps.runVerify ?? runGateVerify;
    let output: GateVerifyOutput;
    try {
      output = await runVerify(
        { store: deps.store, auth: deps.auth },
        {
          repoFullName,
          installationId,
          prNumber,
          baseBranch,
          enableLlmAnalysis,
        },
      );
    } catch (err) {
      log.error(
        `[github-app] gate analyze failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
        err,
      );
      await postCheck(octokit, coords, CODE_QUALITY_CHECK_NAME, eventHeadSha, 'neutral', {
        title: 'TrueCourse Code Quality error',
        summary: 'The gate could not analyze this PR. See server logs.',
      }, cqCheckId).catch(() => undefined);
      cqDone = true;
      return;
    }

    const headSha = output.headSha ?? eventHeadSha;

    // Code Quality: an authoritative Check from the PR-head analyze delta, per the
    // repo's own blocking/threshold config (default block on new high+).
    const cqDecision = decideCodeQuality(output.codeQualityAdded, {
      blocking: link.codeQualityBlocking ?? true,
      minSeverity: deps.minSeverity ?? link.codeQualityMinSeverity ?? 'high',
    });
    await postCheck(
      octokit,
      coords,
      CODE_QUALITY_CHECK_NAME,
      headSha,
      cqDecision.conclusion,
      cqCheckOutput(cqDecision),
      cqCheckId,
    );
    cqDone = true;

    // Record the run (idempotency anchor) regardless of comment success.
    try {
      await deps.store.recordRun({
        id: randomUUID(),
        repoFullName,
        prNumber,
        headSha,
        baseSha: output.baseSha,
        conclusion: cqDecision.conclusion,
        addedCount: cqDecision.added.length,
        resolvedCount: 0,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      log.error(`[github-app] recordRun failed: ${(e as Error).message}`, e);
    }

    // Cosmetic surface — isolated so a failure never affects the Check.
    try {
      const codeQualityUrl = await prCodeQualityUrl(deps.appUrl, repoFullName, prNumber);
      const body = renderGateComment(cqDecision, { codeQualityUrl });
      const existing = await findComment(octokit, coords, prNumber, GATE_MARKER);
      if (existing) await updateComment(octokit, coords, existing.id, body);
      else await createComment(octokit, coords, prNumber, body);
    } catch (err) {
      log.error(
        `[github-app] gate post-processing failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
        err,
      );
    }
  } finally {
    // Safety net: never leave a Check stuck "in progress" if an unexpected error
    // skipped its completion above.
    if (cqCheckId != null && !cqDone) {
      await postCheck(octokit, coords, CODE_QUALITY_CHECK_NAME, eventHeadSha, 'neutral', {
        title: 'TrueCourse Code Quality',
        summary: 'The check did not complete. See server logs.',
      }, cqCheckId).catch(() => undefined);
    }
    deps.gateInFlight?.delete(flightKey);
  }
}
