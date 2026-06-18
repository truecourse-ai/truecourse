/**
 * The drift gate: runs automatically on every PR event (no checkbox),
 * deterministically. Verifies the head vs the base, posts an authoritative
 * GitHub Check (blocking or advisory per repo config), then — isolated so a
 * failure can't downgrade the Check — posts/refreshes a summary comment, adds
 * inline comments on each new drift, and records the run.
 */

import { randomUUID } from 'node:crypto';
import { log } from '@truecourse/core/lib/logger';
import {
  enrichDrifts,
  type EnrichedDrift,
} from '@truecourse/core/lib/drift-enrichment';
import type { GateStore } from './store/types.js';
import type { GithubAuth } from './github.js';
import type { PullRequestPayload } from './webhook.js';
import {
  splitRepo,
  postCheck,
  startCheck,
  createReviewComment,
  listReviewComments,
  findComment,
  createComment,
  updateComment,
  listPrFiles,
  listOpenPrs,
  type OctokitClient,
} from './octokit.js';
import { detectSpecDocChanges } from './spec-detect.js';
import { decideGate, decideCodeQuality, type GateSeverity } from './gate.js';
import {
  GATE_MARKER,
  GATE_CHECK_NAME,
  CODE_QUALITY_CHECK_NAME,
  renderGateComment,
  gateCheckOutput,
  cqCheckOutput,
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
import { wantsNotification } from './notifications.js';
import { contractsDashboardUrl, prSectionUrl } from './links.js';

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
  /** Per-workspace LLM-code-analysis toggle reader; injected by the server, defaults off. */
  codeAnalysisLlm?: (orgId: string) => Promise<boolean>;
}

export async function handlePullRequestGate(
  deps: GateHandlerDeps,
  payload: PullRequestPayload,
  opts: { force?: boolean } = {},
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
  // guard concurrent deliveries of the same sha. `force` (a post-resolution
  // re-verify) intentionally re-gates the SAME head against the now-regenerated
  // contracts, so it bypasses the redelivery skip — the concurrent guard stays.
  const flightKey = `${repoFullName}#${eventHeadSha}`;
  if (deps.gateInFlight?.has(flightKey)) return;
  if (!opts.force) {
    const priorRuns = await deps.store.listRuns(repoFullName, 50);
    if (priorRuns.some((r) => r.headSha === eventHeadSha)) return;
  }
  deps.gateInFlight?.add(flightKey);

  // Open both Checks as "in progress" so the PR shows them running while the gate
  // works (verify + cold contract-gen can take minutes). Completed in the paths
  // below; the `finally` is a safety net so a crash never leaves a Check running.
  const gateCheckId = await startCheck(octokit, coords, GATE_CHECK_NAME, eventHeadSha);
  const cqCheckId = await startCheck(octokit, coords, CODE_QUALITY_CHECK_NAME, eventHeadSha);
  let gateDone = false;
  let cqDone = false;

  try {
    // Did the PR touch any spec docs? If not, the gate verifies the head's code
    // against the base's resolved contracts (no re-scan). If so, it scans the
    // head for its own contracts (the cold path).
    const specChanged =
      detectSpecDocChanges(await listPrFiles(octokit, coords, prNumber)).length > 0;

    const enableLlmAnalysis = link.workspaceOrgId
      ? (await deps.codeAnalysisLlm?.(link.workspaceOrgId)) ?? false
      : false;

    const runVerify = deps.runVerify ?? runGateVerify;
    let output: GateVerifyOutput;
    try {
      output = await runVerify(
        { store: deps.store, auth: deps.auth, verify: deps.verify, scanPipeline: deps.scanPipeline },
        {
          repoFullName,
          installationId,
          prNumber,
          baseBranch,
          defaultBranch: link.defaultBranch,
          // The repo's linked workspace → verify against EFFECTIVE contracts.
          workspaceOrgId: link.workspaceOrgId,
          specChanged,
          enableLlmAnalysis,
        },
      );
    } catch (err) {
      log.error(
        `[github-app] gate verify failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
        err,
      );
      await postCheck(octokit, coords, GATE_CHECK_NAME, eventHeadSha, 'neutral', {
        title: 'TrueCourse drift gate error',
        summary: 'The gate could not verify this PR. See server logs.',
      }, gateCheckId).catch(() => undefined);
      gateDone = true;
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
        ? await contractsDashboardUrl(deps.appUrl, repoFullName, prNumber)
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
      gateCheckId,
    );
    gateDone = true;

    // Code Quality: a SECOND independent Check from the PR-head analyze delta,
    // per the repo's own blocking/threshold config (default block on new high+).
    const cqDecision = decideCodeQuality(output.codeQualityAdded, {
      blocking: link.codeQualityBlocking ?? true,
      minSeverity: link.codeQualityMinSeverity ?? 'high',
    });
    try {
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
    } catch (e) {
      log.error(`[github-app] code quality check post failed: ${(e as Error).message}`, e);
    }

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
      log.error(`[github-app] recordRun failed: ${(e as Error).message}`, e);
    }

    // No PR-diff write: the transient verify already stored the PR head's
    // per-commit snapshot (verify_snapshots), and the dashboard derives the diff
    // against the baseline snapshot on read — nothing diff-specific is persisted.

    // Email — only once the run is recorded, so a webhook redelivery (deduped by
    // the recorded head sha) can't re-send. Unresolved conflicts get the
    // resolve-the-spec notice even when blocking makes the Check fail (its `added`
    // list is empty — the helpful conflict notice beats a generic drift failure);
    // otherwise a blocking failure notifies of the new drift.
    const notifyEmails = link.notifyEmails ?? [];
    const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
    if (recorded && notifyEmails.length > 0 && deps.notifier) {
      if (decision.neutralReason === 'unresolved-conflicts') {
        if (wantsNotification(link, 'conflicts')) {
          void deps.notifier.sendConflictsNeedResolution(notifyEmails, {
            repoFullName,
            prNumber,
            prUrl,
            openConflicts: decision.unresolvedConflicts ?? 0,
            dashboardUrl: conflictsUrl,
          });
        }
      } else if (decision.conclusion === 'failure') {
        if (wantsNotification(link, 'gateFailure')) {
          void deps.notifier.sendGateFailure(notifyEmails, {
            repoFullName,
            prNumber,
            prUrl,
            added: decision.added,
          });
        }
      }
    }

    // Best-effort LLM enrichment of the new drifts into human-readable prose for
    // the cosmetic surfaces. On-demand + cached; degrades to structured rendering
    // when no transport is configured or a call fails. Wrapped so it can NEVER
    // downgrade or block the Check (already posted above) — an empty map just
    // renders the structured snippets, exactly as before.
    let enriched: Map<string, EnrichedDrift> = new Map();
    if (decision.added.length > 0) {
      try {
        enriched = await enrichDrifts(decision.added);
      } catch (err) {
        log.warn(
          `[github-app] drift enrichment failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
        );
      }
    }

    // Cosmetic surfaces — isolated so failures never affect the Check.
    try {
      const [codeQualityUrl, verifyUrl] = await Promise.all([
        prSectionUrl(deps.appUrl, repoFullName, prNumber, 'codequality'),
        prSectionUrl(deps.appUrl, repoFullName, prNumber, 'verification'),
      ]);
      const body = renderGateComment(decision, {
        conflictsUrl,
        enriched,
        codeQuality: cqDecision,
        codeQualityUrl,
        verifyUrl,
      });
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
              body: inlineDriftBody(d, enriched),
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
        err,
      );
    }
  } finally {
    // Safety net: never leave a Check stuck "in progress" if an unexpected error
    // skipped its completion above.
    if (gateCheckId != null && !gateDone) {
      await postCheck(octokit, coords, GATE_CHECK_NAME, eventHeadSha, 'neutral', {
        title: 'TrueCourse drift gate',
        summary: 'The gate did not complete. See server logs.',
      }, gateCheckId).catch(() => undefined);
    }
    if (cqCheckId != null && !cqDone) {
      await postCheck(octokit, coords, CODE_QUALITY_CHECK_NAME, eventHeadSha, 'neutral', {
        title: 'TrueCourse Code Quality',
        summary: 'The check did not complete. See server logs.',
      }, cqCheckId).catch(() => undefined);
    }
    deps.gateInFlight?.delete(flightKey);
  }
}

/**
 * Re-verify every OPEN PR for a repo against its CURRENT contracts. Called after
 * a dashboard conflict-resolution + contract regeneration (the repo.contracts
 * job): the head's contracts changed, so each open PR's gate verdict may have too
 * — a PR that was paused on `unresolved-conflicts` now gets a real verdict. Each
 * PR re-gates with `force` (the head was gated before) so the verdict + comment
 * refresh WITHOUT waiting for a new push. Per-PR failures are isolated.
 */
export async function reverifyOpenPrs(
  deps: GateHandlerDeps,
  repoFullName: string,
): Promise<void> {
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;
  const coords = splitRepo(repoFullName);
  const octokit = deps.octokitFor(link.installationId);
  const prs = await listOpenPrs(octokit, coords);
  for (const pr of prs) {
    const payload: PullRequestPayload = {
      action: 'synchronize',
      number: pr.number,
      pull_request: {
        head: {
          sha: pr.headSha,
          ref: pr.headRef,
          repo: pr.headRepoFullName
            ? { full_name: pr.headRepoFullName, fork: pr.headRepoIsFork }
            : null,
        },
        base: { sha: pr.baseSha, ref: pr.baseRef },
      },
      repository: { full_name: repoFullName, default_branch: link.defaultBranch },
      installation: { id: link.installationId },
    };
    await handlePullRequestGate(deps, payload, { force: true }).catch((err) =>
      log.error(
        `[github-app] re-verify failed for ${repoFullName} PR#${pr.number}: ${(err as Error).message}`,
        err,
      ),
    );
  }
}

// Settable seam so the EE jobs layer can trigger a PR re-verify after the
// repo.contracts job regenerates contracts, without ee-server reaching into the
// gate's deps. `registerGithubApp` sets it (closing over the gate deps); the jobs
// layer reads it. Null when the GitHub App isn't configured → a no-op.
let prReverifier: ((repoFullName: string) => Promise<void>) | null = null;
export function setPrReverifier(
  fn: ((repoFullName: string) => Promise<void>) | null,
): void {
  prReverifier = fn;
}
export function getPrReverifier(): ((repoFullName: string) => Promise<void>) | null {
  return prReverifier;
}
