/**
 * Guard-gate webhook handler: on a PR event, open the in-progress Spec Guard
 * Check for the head sha and enqueue the durable `guard.gate` job that completes it.
 * All the heavy work (clone, base resolution, scenario execution, verdict) lives
 * in the job's pipeline — this handler is fast: one Check create + one enqueue,
 * so the Check sits "running" while the job is queued and survives a restart as
 * a durable row.
 */

import type { GateStore } from './store/types.js';
import type { PullRequestPayload } from './webhook.js';
import { splitRepo, startCheck, postCheck, type OctokitClient } from './octokit.js';
import { PR_TRIGGER_ACTIONS } from './pr-events.js';
import { GUARD_GATE_CHECK_NAME } from './guard-gate-comment.js';
import type { GuardGateRunRequest } from './guard-gate-runner.js';

/**
 * Enqueue a guard-gate run onto the background job queue. Returns the job id,
 * or null when a gate is already running for that head (single-flight per
 * repo + head SHA). Supplied by ee-server (the jobs runtime); the registration
 * fallback runs the pipeline inline so unit tests need no queue.
 */
export type EnqueueGuardGate = (req: GuardGateRunRequest) => Promise<string | null>;

export interface GuardGateHandlerDeps {
  store: GateStore;
  octokitFor: (installationId: number) => OctokitClient;
  enqueueGuardGate: EnqueueGuardGate;
}

export async function handlePullRequestGuardGate(
  deps: GuardGateHandlerDeps,
  payload: PullRequestPayload,
): Promise<void> {
  if (!PR_TRIGGER_ACTIONS.includes(payload.action)) return;
  if (!payload.installation) return;
  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  const coords = splitRepo(repoFullName);
  const octokit = deps.octokitFor(payload.installation.id);
  const headSha = payload.pull_request.head.sha;

  // Open the in-progress Check FIRST so its id rides the durable payload — the
  // job completes THAT run, and the PR shows "running" while the job is queued.
  const checkRunId = await startCheck(octokit, coords, GUARD_GATE_CHECK_NAME, headSha);

  const jobId = await deps.enqueueGuardGate({
    repoFullName,
    installationId: payload.installation.id,
    workspaceOrgId: link.workspaceOrgId,
    prNumber: payload.number,
    defaultBranch: payload.repository.default_branch || link.defaultBranch,
    baseBranch: payload.pull_request.base.ref || link.defaultBranch,
    baseSha: payload.pull_request.base.sha,
    headSha,
    headRef: payload.pull_request.head.ref,
    isFork: payload.pull_request.head.repo?.fork ?? false,
    checkRunId,
  });

  // A duplicate delivery (a gate for this head is already active) must not
  // strand the Check we just opened — the running job completes ITS OWN run,
  // never this one. Best-effort: hygiene only, the verdict lives elsewhere.
  if (jobId === null && checkRunId != null) {
    await postCheck(
      octokit,
      coords,
      GUARD_GATE_CHECK_NAME,
      headSha,
      'neutral',
      {
        title: 'Guard gate already running',
        summary:
          'A guard gate run for this head commit is already in progress; its Check carries the verdict.',
      },
      checkRunId,
    ).catch(() => undefined);
  }
}
