/**
 * The drift gate: runs automatically on every PR event (no checkbox),
 * deterministically. Verifies the head vs the base, posts an authoritative
 * GitHub Check (blocking or advisory per repo config), then — isolated so a
 * failure can't downgrade the Check — posts/refreshes a summary comment, adds
 * inline comments on each new drift, and records the run.
 */

import { randomUUID } from 'node:crypto';
import { log } from '@truecourse/core/lib/logger';
import type { GateStore } from './store/types.js';
import type { GithubAuth } from './github.js';
import type { PullRequestPayload } from './webhook.js';
import {
  splitRepo,
  postCheck,
  createReviewComment,
  listReviewComments,
  findComment,
  createComment,
  updateComment,
  type OctokitClient,
} from './octokit.js';
import { decideGate, type GateSeverity } from './gate.js';
import {
  GATE_MARKER,
  GATE_CHECK_NAME,
  renderGateComment,
  gateCheckOutput,
  inlineDriftBody,
} from './gate-comment.js';
import {
  runGateVerify,
  type GateVerifyDeps,
  type GateVerifyRequest,
  type GateVerifyOutput,
  type VerifyFn,
} from './gate-runner.js';
import type { SpecScanPipeline } from './spec-scan.js';
import type { EmailNotifier } from './email.js';
import { contractsDashboardUrl } from './links.js';

const GATE_ACTIONS = ['opened', 'synchronize', 'reopened'];
const MAX_INLINE = 25;

export interface GateHandlerDeps {
  store: GateStore;
  auth: GithubAuth;
  /** Dashboard base URL, for the "resolve conflicts" link when the gate pauses. */
  appUrl?: string;
  octokitFor: (installationId: number) => OctokitClient;
  verify?: VerifyFn;
  /** Scan+generate pipeline for the gate's cold contract-generation path. */
  scanPipeline?: SpecScanPipeline;
  runVerify?: (
    deps: GateVerifyDeps,
    req: GateVerifyRequest,
  ) => Promise<GateVerifyOutput>;
  /** Min severity that fails the gate (default: any). */
  minSeverity?: GateSeverity;
  /** In-flight guard keyed by `${repo}#${headSha}` (concurrent deliveries). */
  gateInFlight?: Set<string>;
  /** Email notifier (Resend); set when RESEND_API_KEY is configured. */
  notifier?: EmailNotifier;
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

  try {
    const runVerify = deps.runVerify ?? runGateVerify;
    let output: GateVerifyOutput;
    try {
      output = await runVerify(
        { store: deps.store, auth: deps.auth, verify: deps.verify, scanPipeline: deps.scanPipeline },
        { repoFullName, installationId, prNumber, baseBranch, defaultBranch: link.defaultBranch },
      );
    } catch (err) {
      log.error(
        `[github-app] gate verify failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
      );
      await postCheck(octokit, coords, GATE_CHECK_NAME, eventHeadSha, 'neutral', {
        title: 'TrueCourse drift gate error',
        summary: 'The gate could not verify this PR. See server logs.',
      }).catch(() => undefined);
      return;
    }

    const headSha = output.headSha ?? eventHeadSha;
    const decision = decideGate(output.baseDrifts, output.headDrifts, {
      blocking: link.blocking,
      minSeverity: deps.minSeverity,
      unresolvedConflicts: output.headConflicts,
    });
    // Where humans go to resolve the head's spec conflicts (neutral case).
    const conflictsUrl =
      decision.neutralReason === 'unresolved-conflicts'
        ? await contractsDashboardUrl(deps.appUrl, repoFullName, headSha)
        : undefined;

    // Authoritative: post the completed Check (anchored to the sha we verified)
    // before any cosmetic surface.
    await postCheck(
      octokit,
      coords,
      GATE_CHECK_NAME,
      headSha,
      decision.conclusion,
      gateCheckOutput(decision),
    );

    // Record the run (idempotency anchor) regardless of comment success.
    let recorded = false;
    try {
      await deps.store.recordRun({
        id: randomUUID(),
        repoFullName,
        prNumber,
        headSha,
        baseSha: output.baseSha,
        conclusion: decision.conclusion,
        addedCount: decision.added.length,
        resolvedCount: decision.resolved.length,
        createdAt: new Date().toISOString(),
      });
      recorded = true;
    } catch (e) {
      log.error(`[github-app] recordRun failed: ${(e as Error).message}`);
    }

    // Email — only once the run is recorded, so a webhook redelivery (deduped by
    // the recorded head sha) can't re-send. A blocking failure notifies of the
    // new drift; an unresolved-conflicts pause asks the team to resolve the spec.
    const notifyEmails = link.notifyEmails ?? [];
    const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
    if (recorded && notifyEmails.length > 0 && deps.notifier) {
      if (decision.conclusion === 'failure') {
        void deps.notifier.sendGateFailure(notifyEmails, {
          repoFullName,
          prNumber,
          prUrl,
          added: decision.added,
        });
      } else if (decision.neutralReason === 'unresolved-conflicts') {
        void deps.notifier.sendConflictsNeedResolution(notifyEmails, {
          repoFullName,
          prNumber,
          prUrl,
          openConflicts: decision.unresolvedConflicts ?? 0,
          dashboardUrl: conflictsUrl,
        });
      }
    }

    // Cosmetic surfaces — isolated so failures never affect the Check.
    try {
      const body = renderGateComment(decision, { conflictsUrl });
      const existing = await findComment(octokit, coords, prNumber, GATE_MARKER);
      if (existing) await updateComment(octokit, coords, existing.id, body);
      else await createComment(octokit, coords, prNumber, body);

      if (decision.added.length > 0) {
        const seen = new Set(
          (await listReviewComments(octokit, coords, prNumber)).map(
            (c) => `${c.path}:${c.line}`,
          ),
        );
        for (const d of decision.added.slice(0, MAX_INLINE)) {
          if (seen.has(`${d.filePath}:${d.lineStart}`)) continue;
          try {
            await createReviewComment(octokit, coords, prNumber, {
              commitId: headSha,
              path: d.filePath,
              line: d.lineStart,
              body: inlineDriftBody(d),
            });
          } catch (e) {
            const status = (e as { status?: number }).status;
            // 422 = line not in the diff, 404 = file not in the PR — expected,
            // covered by the summary. Anything else is a real failure.
            if (status !== 422 && status !== 404) {
              log.warn(
                `[github-app] inline comment failed (${status ?? '?'}) on ${d.filePath}:${d.lineStart}`,
              );
            }
          }
        }
      }
    } catch (err) {
      log.error(
        `[github-app] gate post-processing failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
      );
    }
  } finally {
    deps.gateInFlight?.delete(flightKey);
  }
}
