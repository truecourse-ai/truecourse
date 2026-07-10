/**
 * Job task identifiers + payload shapes, kept dependency-free so routers can
 * reference them without pulling in graphile-worker (only the worker does).
 */

import type { GuardGateRunRequest, GuardSpecRegenRequest } from '@truecourse/ee-github-app';

/** A single phase in a job's stepped-progress checklist (popup). */
export interface JobStepDef {
  key: string;
  label: string;
}

export const REPO_BASELINE_TASK = 'repo.baseline';

/** Display title + stepped checklist for the repo-scan job popup. */
export const REPO_BASELINE_TITLE = 'Scanning repository';
export const REPO_BASELINE_STEPS: readonly JobStepDef[] = [
  { key: 'clone', label: 'Cloning repository' },
  { key: 'spec', label: 'Extracting spec' },
  { key: 'analyze', label: 'Analyzing code' },
];

/** Single-flight key for a repo-baseline job — one scan per repo at a time. */
export function baselineJobKey(repoFullName: string): string {
  return `${REPO_BASELINE_TASK}:${repoFullName}`;
}

/** Hosted guard-scenario generation for a connected repo — chained onto the
 *  first successful baseline (onboarding) and triggered manually from the
 *  dashboard's hosted "Generate" button (`POST /api/ee/guard/generate`). */
export const REPO_GUARD_TASK = 'repo.guard';

/** Display title + stepped checklist for the guard-generate job popup. The
 *  `generate` step carries the OSS GUARD_GENERATE_STEPS sub-phases as detail. */
export const REPO_GUARD_TITLE = 'Generating guard scenarios';
export const REPO_GUARD_STEPS: readonly JobStepDef[] = [
  { key: 'clone', label: 'Cloning repository' },
  { key: 'generate', label: 'Generating scenarios' },
];

/** Single-flight key for a `repo.guard` job — one generate per repo at a time. */
export function guardJobKey(repoFullName: string): string {
  return `${REPO_GUARD_TASK}:${repoFullName}`;
}

/** What a caller (baseline chain / guard route) hands to `enqueueGuardGenerate`. */
export interface GuardGenerateEnqueueRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  /** Default-branch head — the generated scenarios persist under it. */
  commitSha: string;
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
}

/** The worker's `repo.guard` task payload (the enqueue request plus the job id). */
export interface GuardGenerateJobPayload extends GuardGenerateEnqueueRequest {
  jobId: string;
}

/** Hosted guard gate for a pull request — runs the committed scenario corpus
 *  against the PR head and posts the diff verdict as a GitHub Check. */
export const GUARD_GATE_TASK = 'guard.gate';

/** Display title + stepped checklist for the guard-gate job popup. Step keys
 *  are the gate pipeline's phase literals (github-app), advanced over onPhase. */
export const GUARD_GATE_TITLE = 'Guarding pull request';
export const GUARD_GATE_STEPS: readonly JobStepDef[] = [
  { key: 'clone', label: 'Cloning repository' },
  { key: 'base', label: 'Establishing baseline' },
  { key: 'run', label: 'Running scenarios' },
  { key: 'verdict', label: 'Posting Check' },
];

/** Single-flight key for a `guard.gate` job — per repo AND head SHA: two PRs
 *  (or two pushes) gate concurrently, but a redelivered webhook for the same
 *  head is a no-op. */
export function guardGateJobKey(repoFullName: string, headSha: string): string {
  return `${GUARD_GATE_TASK}:${repoFullName}#${headSha}`;
}

/** What the pull-request webhook hands to `enqueueGuardGate` — exactly the
 *  github-app pipeline's run request (one authoritative shape, not a hand-synced
 *  copy). The type-only import keeps this module runtime-dependency-free. */
export type GuardGateEnqueueRequest = GuardGateRunRequest;

/** The worker's `guard.gate` task payload (the enqueue request plus the job id). */
export interface GuardGateJobPayload extends GuardGateEnqueueRequest {
  jobId: string;
}

/** Spec-change checkbox regen: a writer ticked the "regenerate scenarios for this
 *  PR head" box — clone the head, re-scan its spec docs, generate scenarios, persist
 *  them under the head, and re-gate the PR against the PR's own regenerated corpus. */
export const GUARD_SPEC_REGEN_TASK = 'guard.spec-regen';

/** Display title + stepped checklist for the spec-regen job popup. */
export const GUARD_SPEC_REGEN_TITLE = 'Regenerating guard scenarios';
export const GUARD_SPEC_REGEN_STEPS: readonly JobStepDef[] = [
  { key: 'clone', label: 'Cloning repository' },
  { key: 'scan', label: 'Scanning spec documents' },
  { key: 'generate', label: 'Generating scenarios' },
  { key: 'gate', label: 'Re-gating pull request' },
];

/** Single-flight key for a `guard.spec-regen` job — per repo + head SHA (mirrors
 *  the gate: two heads regenerate concurrently, a duplicate for one head no-ops). */
export function guardSpecRegenJobKey(repoFullName: string, headSha: string): string {
  return `${GUARD_SPEC_REGEN_TASK}:${repoFullName}#${headSha}`;
}

/** What the checkbox tick hands to `enqueueGuardSpecRegen` — the github-app request
 *  shape (one authoritative type; a type-only import keeps this module runtime-free). */
export type GuardSpecRegenEnqueueRequest = GuardSpecRegenRequest;

/** The worker's `guard.spec-regen` task payload (the enqueue request plus the job id). */
export interface GuardSpecRegenJobPayload extends GuardSpecRegenEnqueueRequest {
  jobId: string;
}

/** What a caller (connect / push webhook) hands to `enqueueBaseline`. */
export interface BaselineEnqueueRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /**
   * Bypass the "baseline already current for this commit" skip. Set when a spec
   * conflict was resolved on an UNCHANGED commit (post-conflict-resolve), so the
   * corpus re-curates even though the head didn't move. Left unset for
   * connect/push (their dedup is intentional).
   */
  force?: boolean;
  /** Suppress the success notification (still tracks the job + notifies on FAILURE). */
  quiet?: boolean;
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
}

/** The worker's task payload (the enqueue request plus the created job id). */
export interface BaselineJobPayload extends BaselineEnqueueRequest {
  jobId: string;
}

/**
 * Enqueue an initial/refresh repo baseline (connect / push / post-resolve). Returns
 * the new job id, or null when a baseline is already running for that repo
 * (single-flight).
 */
export type EnqueueBaseline = (req: BaselineEnqueueRequest) => Promise<string | null>;
