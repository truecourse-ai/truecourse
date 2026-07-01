/**
 * GitHub App (PR gate) — enterprise plugin module.
 *
 * Composed by `@truecourse/ee-server`'s `register()`: it mounts the public
 * webhook receiver and the protected connect router, and reports whether the
 * `github-gate` capability should light up (i.e. the App is configured).
 */

import type { EeServerRegistry } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
import { log } from '@truecourse/core/lib/logger';
import { loadGithubAppConfig } from './config.js';
import { createGithubAuth } from './github.js';
import { selectGateStore } from './store/index.js';
import { runBaseline } from './baseline.js';
import { createWebhookRouter } from './webhook.js';
import { createConnectRouter } from './connect.js';
import { installationOctokit } from './octokit.js';
import {
  handlePullRequestInferOffer,
  handleCommentEditedInfer,
} from './infer-offer.js';
import {
  handlePullRequestGate,
  reverifyOpenPrs,
  setPrReverifier,
} from './gate-handler.js';
import { createEmailNotifier } from './email.js';
import { reportGithubError } from './observability.js';

/**
 * Enqueue an initial/refresh repo scan onto the background job queue. Returns the
 * job id, or null when a scan is already running for the repo. Supplied by
 * ee-server (the jobs runtime); when absent, the gate falls back to running the
 * baseline inline (fire-and-forget) so unit tests need no queue.
 */
export type EnqueueBaseline = (req: {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  workspaceOrgId: string;
}) => Promise<string | null>;

export interface RegisterGithubAppOptions {
  /** Dashboard client origin for browser-facing redirects (e.g. /setup). */
  appUrl?: string;
  /** Shared ee-db (Postgres) when hosted; null → the file gate store. */
  db?: EeDb | null;
  /** Background-queue enqueue for repo scans (connect + push). Inline fallback if omitted. */
  enqueueBaseline?: EnqueueBaseline;
  /** Per-workspace LLM-code-analysis toggle reader; injected by the server, defaults off. */
  codeAnalysisLlm?: (orgId: string) => Promise<boolean>;
}

/**
 * Register the GitHub App routers if configured. Returns true when the
 * `github-gate` capability should be advertised, false when the App env is
 * absent (so SSO-only enterprise deploys are unaffected).
 */
export async function registerGithubApp(
  registry: EeServerRegistry,
  opts: RegisterGithubAppOptions = {},
): Promise<boolean> {
  const cfg = loadGithubAppConfig();
  if (!cfg) {
    log.info(
      '[github-app] not configured (GITHUB_APP_* unset) — github-gate off',
    );
    return false;
  }

  const appUrl =
    opts.appUrl ?? process.env.WORKOS_APP_URL ?? 'http://localhost:3000';
  const store = selectGateStore(opts.db ?? null);
  const auth = createGithubAuth(cfg);
  const notifier = cfg.resendApiKey
    ? createEmailNotifier(cfg.resendApiKey, cfg.emailFrom)
    : undefined;

  // Shared deps for the gate + interactive flows. The comment in-flight set is
  // keyed by comment id (scan/infer use distinct comments), the offer set by
  // `${repo}#${pr}#<type>`, and the gate set by `${repo}#${sha}` — so all of
  // them safely share this object.
  const offerDeps = {
    store,
    auth,
    appUrl,
    octokitFor: (installationId: number) => installationOctokit(cfg, installationId),
    inFlight: new Set<number>(),
    offerInFlight: new Set<string>(),
    gateInFlight: new Set<string>(),
    notifier,
    codeAnalysisLlm: opts.codeAnalysisLlm,
  };

  // Let the EE jobs layer re-verify open PRs after the repo.contracts job
  // regenerates contracts (post-conflict-resolution), without reaching into the
  // gate's deps. The seam is null until set here, so SSO-only deploys no-op.
  setPrReverifier((repoFullName) => reverifyOpenPrs(offerDeps, repoFullName));

  // Public: GitHub posts here with no session; verified by HMAC signature.
  registry.registerRouter(
    '/api/ee/github',
    createWebhookRouter({
      secret: cfg.webhookSecret,
      store,
      onBaseline: (trigger) => {
        // Refresh the repo's spec → contracts → drift-gate baseline on a merge to
        // the default branch. Prefer the background job queue (progress + a
        // notification, durable); fall back to inline fire-and-forget when no
        // queue is wired (unit tests). EE does not run the OSS code-analysis pass.
        const repo = trigger.repoFullName;
        if (opts.enqueueBaseline) {
          void opts.enqueueBaseline(trigger).catch((err) =>
            reportGithubError(store, 'baseline enqueue failed', { repo }, err),
          );
          return;
        }
        void runBaseline({ store, auth }, trigger).catch((err) =>
          reportGithubError(store, 'baseline failed', { repo }, err),
        );
      },
      // On PR open/sync: run the drift gate (Phase 4) — it scans the head's specs
      // automatically when the PR changes them — and offer an infer run (Phase 3).
      onPullRequest: (payload) => {
        const ctx = { repo: payload.repository.full_name, pr: payload.number };
        // Run the gate FIRST, then infer — never concurrently. The gate generates
        // the head's contracts (the cold path, when the PR changed a spec); infer
        // subtracts those contracts to decide what's still undocumented. Racing them
        // means infer reads before the contracts exist and re-offers decisions the PR
        // just documented. A gate failure still lets infer run — it falls back to the
        // baseline contracts (see InferInProcessOptions.contractsRef).
        void (async () => {
          await handlePullRequestGate(offerDeps, payload).catch((err) =>
            reportGithubError(store, 'gate failed', ctx, err),
          );
          await handlePullRequestInferOffer(offerDeps, payload).catch((err) =>
            reportGithubError(store, 'infer offer failed', ctx, err),
          );
        })();
      },
      // On comment edit: the matching handler (by marker) runs its checkbox flow.
      onCommentEdited: (payload) => {
        const ctx = { repo: payload.repository.full_name, pr: payload.issue.number };
        void handleCommentEditedInfer(offerDeps, payload).catch((err) =>
          reportGithubError(store, 'comment-edited infer failed', ctx, err),
        );
      },
    }),
    { public: true },
  );

  // Protected: dashboard connect/config endpoints, scoped to the workspace.
  registry.registerRouter(
    '/api/ee/github',
    createConnectRouter({
      store,
      appSlug: cfg.appSlug,
      appUrl,
      octokitFor: (installationId: number) => installationOctokit(cfg, installationId),
      enqueueBaseline: opts.enqueueBaseline,
    }),
  );

  log.info('[github-app] registered — github-gate on');
  return true;
}

export { verifyWebhookSignature } from './signature.js';
export { createWebhookRouter } from './webhook.js';
export type {
  BaselineTrigger,
  PullRequestPayload,
  IssueCommentPayload,
} from './webhook.js';
export { createConnectRouter } from './connect.js';
export { runBaseline, type BaselineResult } from './baseline.js';
export { loadGithubAppConfig } from './config.js';
export { createGithubAuth, getInstallationToken, cloneUrl, type GithubAuth } from './github.js';
export * from './store/index.js';

// Phase 2: spec-doc scan
export {
  isSpecDoc,
  detectSpecDocChanges,
  isCodeFile,
  hasCodeChanges,
} from './spec-detect.js';
export { runSpecScan, type SpecScanPipeline } from './spec-scan.js';
export {
  installationOctokit,
  splitRepo,
  findComment,
  type OctokitClient,
} from './octokit.js';
export { readRepoDocFromGithub } from './repo-doc.js';

// Phase 3: infer undocumented decisions
export {
  INFER_MARKER,
  INFER_CHECKBOX_LABEL,
  renderInferComment,
  isInferComment,
  isInferCheckboxChecked,
  hasInferOffer,
  type InferCommentStatus,
  type DecisionSummary,
} from './infer-comment.js';
export { runInfer, defaultInferPipeline, type InferPipeline } from './infer-scan.js';
export { diffDecisions, type InferDiff } from '@truecourse/core/lib/inferred-decisions';
export {
  handlePullRequestInferOffer,
  handleCommentEditedInfer,
  type InferOfferDeps,
} from './infer-offer.js';

// Phase 4: drift gate
export {
  decideGate,
  decideCodeQuality,
  type GateConclusion,
  type GateDecision,
  type GateOptions,
  type GateSeverity,
  type CodeQualityDecision,
  type CodeQualityOptions,
} from './gate.js';
export {
  GATE_MARKER,
  GATE_CHECK_NAME,
  CODE_QUALITY_CHECK_NAME,
  isGateComment,
  renderGateComment,
  gateCheckOutput,
  cqCheckOutput,
  inlineDriftBody,
  type DriftEnrichmentMap,
} from './gate-comment.js';
export {
  runGateVerify,
  driftsForCommit,
  type VerifyFn,
  type GateVerifyOutput,
  type CommitDrifts,
} from './gate-runner.js';
export {
  handlePullRequestGate,
  reverifyOpenPrs,
  setPrReverifier,
  getPrReverifier,
  type GateHandlerDeps,
} from './gate-handler.js';

// Phase 5: email notifications
export {
  createEmailNotifier,
  type EmailNotifier,
  type GateFailureEmail,
  type ConflictsEmail,
  type ResendLike,
} from './email.js';
