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

export const KNOWLEDGE_SYNC_TASK = 'knowledge.sync';

export interface SyncJobPayload {
  jobId: string;
  org: string;
  /**
   * The connector whose Process button (or decision write) dispatched this run —
   * for the toast/attribution only. Processing is workspace-scoped: the job
   * consolidates the UNION of every connected source regardless of `kind`.
   */
  kind: string;
}

/**
 * Single-flight key for a `knowledge.sync` (processing) job — ONE per workspace at
 * a time, not per connector: every source's Process button dispatches the same
 * union job, so a second click (any source) while one runs is a no-op.
 */
export function workspaceSyncJobKey(org: string): string {
  return `${KNOWLEDGE_SYNC_TASK}:${org}`;
}

/** The sweep stage: sweep the source and price the work to process (no LLM), then
 *  persist a pending record so the Process button + its cost are workspace-visible. */
export const KNOWLEDGE_ESTIMATE_TASK = 'knowledge.estimate';

/** Same resolved target as a sync (org + connector kind); the result carries the estimate. */
export type EstimateJobPayload = SyncJobPayload;

/** Display title + stepped checklist for the sweep job popup. The estimate is an
 *  internal by-product of the sweep — the user-visible step is the change diff. */
export const KNOWLEDGE_ESTIMATE_TITLE = 'Syncing knowledge';
export const KNOWLEDGE_ESTIMATE_STEPS: readonly JobStepDef[] = [
  { key: 'fetch', label: 'Fetching documents' },
  { key: 'estimate', label: 'Checking for changes' },
];

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

/** Display title + stepped checklist for the processing job popup. */
export const KNOWLEDGE_SYNC_TITLE = 'Processing knowledge';
export const KNOWLEDGE_SYNC_STEPS: readonly JobStepDef[] = [
  { key: 'fetch', label: 'Fetching documents' },
  { key: 'consolidate', label: 'Consolidating spec' },
];

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

/** Guard baseline refresh — re-run the committed scenario corpus against the
 *  default branch and persist the result as the repo's guard baseline, so the
 *  next PR gate diffs against current main without a lazy base run. Chained after
 *  a default-branch merge (repo already has scenarios) and after an onboarding /
 *  backfill generate; enqueued once per repo at boot for the deploy backfill. */
export const GUARD_BASELINE_TASK = 'guard.baseline';

/** Display title + stepped checklist for the guard-baseline job popup. */
export const GUARD_BASELINE_TITLE = 'Refreshing guard baseline';
export const GUARD_BASELINE_STEPS: readonly JobStepDef[] = [
  { key: 'clone', label: 'Cloning repository' },
  { key: 'run', label: 'Running scenarios' },
  { key: 'persist', label: 'Saving baseline' },
];

/** Single-flight key for a `guard.baseline` job — one refresh per repo at a time. */
export function guardBaselineJobKey(repoFullName: string): string {
  return `${GUARD_BASELINE_TASK}:${repoFullName}`;
}

/** What a caller (merge chain / generate chain / backfill) hands to `enqueueGuardBaseline`. */
export interface GuardBaselineEnqueueRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  /** Default-branch head to run the baseline against. */
  commitSha: string;
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
}

/** The worker's `guard.baseline` task payload (the enqueue request plus the job id). */
export interface GuardBaselineJobPayload extends GuardBaselineEnqueueRequest {
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
