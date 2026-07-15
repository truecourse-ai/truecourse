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
import { notifierFromConfig } from './email.js';
import { selectGateStore } from './store/index.js';
import { runBaseline } from './baseline.js';
import { createWebhookRouter } from './webhook.js';
import { createConnectRouter } from './connect.js';
import { installationOctokit, splitRepo, updateComment } from './octokit.js';
import {
  handlePullRequestGuardSpecOffer,
  handleCommentEditedGuardSpec,
  type EnqueueGuardSpecRegen,
} from './guard-spec-offer.js';
import { renderGuardSpecComment } from './guard-spec-comment.js';
import { defaultGuardHeadRegenPipeline } from './guard-head-regen.js';
import { createGuardGatePipeline } from './guard-gate-runner.js';
import { handlePullRequestGate } from './gate-handler.js';
import { handlePullRequestClosed } from './pr-closed.js';
import { upsertPrState } from './pr-state.js';
import { reportGithubError } from './observability.js';
import { getGuardStore } from '@truecourse/core/lib/guard-store';
import { getGuardExecutor } from '@truecourse/core/lib/guard-executor';
import { handlePullRequestGuardGate, type EnqueueGuardGate } from './guard-gate-handler.js';
import { defaultGuardGatePipeline } from './guard-gate-runner.js';

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
  /** Background-queue enqueue for guard-gate runs (PR events). Inline fallback if omitted. */
  enqueueGuardGate?: EnqueueGuardGate;
  /** Background-queue enqueue for spec-change guard regens (checkbox tick). Inline fallback if omitted. */
  enqueueGuardSpecRegen?: EnqueueGuardSpecRegen;
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
  const notifier = notifierFromConfig(cfg);

  // Shared deps for the Code Quality gate. The gate in-flight set is keyed by
  // `${repo}#${sha}` (concurrent deliveries of the same head).
  const offerDeps = {
    store,
    auth,
    appUrl,
    octokitFor: (installationId: number) => installationOctokit(cfg, installationId),
    gateInFlight: new Set<string>(),
    codeAnalysisLlm: opts.codeAnalysisLlm,
  };

  // Guard-gate enqueue: prefer the durable background queue (ee-server); fall
  // back to running the gate pipeline inline fire-and-forget so unit tests need
  // no queue (mirrors enqueueBaseline's fallback). The inline path shares the
  // process-global guard store/executor seams; without the jobs layer there is
  // no shared limiter, so executor calls run unlimited.
  const enqueueGuardGate: EnqueueGuardGate =
    opts.enqueueGuardGate ??
    (async (req) => {
      void defaultGuardGatePipeline
        .run(
          {
            store,
            guardStore: getGuardStore(),
            auth,
            octokitFor: offerDeps.octokitFor,
            execute: getGuardExecutor(),
            limiter: { run: (fn) => fn() },
            notifier,
            appUrl,
          },
          req,
        )
        .catch((err) =>
          reportGithubError(
            store,
            'guard gate failed',
            { repo: req.repoFullName, pr: req.prNumber },
            err,
          ),
        );
      return null;
    });

  // Guard spec-regen enqueue: prefer the durable queue (ee-server); fall back to
  // running the regen + re-gate inline fire-and-forget so unit tests need no queue
  // (mirrors enqueueGuardGate). The inline path settles the checkbox comment and
  // re-gates against the PR's freshly regenerated corpus.
  const enqueueGuardSpecRegen: EnqueueGuardSpecRegen =
    opts.enqueueGuardSpecRegen ??
    (async (req) => {
      const octokit = offerDeps.octokitFor(req.installationId);
      const coords = splitRepo(req.repoFullName);
      // A dashboard-triggered regen has no checkbox comment to settle.
      const settleComment = async (body: string): Promise<void> => {
        if (req.commentId == null) return;
        await updateComment(octokit, coords, req.commentId, body);
      };
      void (async () => {
        const regen = await defaultGuardHeadRegenPipeline.run(
          { auth },
          {
            repoFullName: req.repoFullName,
            installationId: req.installationId,
            prNumber: req.prNumber,
            baseBranch: req.baseBranch,
            headSha: req.headSha,
          },
        );
        if (regen.noCorpus || !regen.corpus) {
          await settleComment(renderGuardSpecComment('nochange'));
          return;
        }
        const corpus = regen.corpus;
        await createGuardGatePipeline({ loadCorpus: async () => corpus }).run(
          {
            store,
            guardStore: getGuardStore(),
            auth,
            octokitFor: offerDeps.octokitFor,
            execute: getGuardExecutor(),
            limiter: { run: (fn) => fn() },
            notifier,
            appUrl,
          },
          {
            repoFullName: req.repoFullName,
            installationId: req.installationId,
            workspaceOrgId: req.workspaceOrgId,
            prNumber: req.prNumber,
            defaultBranch: req.defaultBranch,
            baseBranch: req.baseBranch,
            baseSha: req.baseSha,
            headSha: req.headSha,
            headRef: req.headRef,
            isFork: req.isFork,
            checkRunId: null,
          },
          { force: true },
        );
        await settleComment(
          renderGuardSpecComment('done', {
            scenariosWritten: regen.scenariosWritten,
            commitSha: req.headSha,
          }),
        );
      })().catch(async (err) => {
        await settleComment(
          renderGuardSpecComment('error', { error: (err as Error).message }),
        ).catch(() => undefined);
        reportGithubError(
          store,
          'guard spec-regen failed',
          { repo: req.repoFullName, pr: req.prNumber },
          err,
        );
      });
      return null;
    });

  // The spec-change guard checkbox keeps its own in-flight sets (offer path
  // keyed per repo#pr, checkbox path per comment id) and enqueues onto the
  // guard spec-regen queue.
  const specOfferDeps = {
    store,
    octokitFor: offerDeps.octokitFor,
    enqueueGuardSpecRegen,
    notifier,
    offerInFlight: new Set<string>(),
    inFlight: new Set<number>(),
  };

  // Public: GitHub posts here with no session; verified by HMAC signature.
  registry.registerRouter(
    '/api/ee/github',
    createWebhookRouter({
      secret: cfg.webhookSecret,
      store,
      onBaseline: (trigger) => {
        // Refresh the repo's spec + Code Quality baseline on a merge to the default
        // branch. Prefer the background job queue (progress + a notification,
        // durable); fall back to inline fire-and-forget when no queue is wired
        // (unit tests).
        const repo = trigger.repoFullName;
        if (opts.enqueueBaseline) {
          void opts.enqueueBaseline(trigger).catch((err) =>
            reportGithubError(store, 'baseline enqueue failed', { repo }, err),
          );
          return;
        }
        void runBaseline(
          { store, auth, octokitFor: (id) => installationOctokit(cfg, id) },
          trigger,
        ).catch((err) => reportGithubError(store, 'baseline failed', { repo }, err));
      },
      // On PR open/sync: run the Code Quality gate (analyze the head vs the baseline).
      onPullRequest: (payload) => {
        const ctx = { repo: payload.repository.full_name, pr: payload.number };
        // Track the PR's open/closed/merged state for the dashboard feed first —
        // independent of the gate outcome below, and non-fatal on failure.
        void upsertPrState(store, payload).catch((err) =>
          reportGithubError(store, 'pr state upsert failed', ctx, err),
        );
        // Merge/close: promote (merged) or discard (unmerged) the PR's spec-decision
        // overlay + clean up its PR-scoped Code Quality diff. The gate doesn't react
        // to `closed`, so handle it here and stop.
        if (payload.action === 'closed') {
          void handlePullRequestClosed(payload).catch((err) =>
            reportGithubError(store, 'pr closed handling failed', ctx, err),
          );
          return;
        }
        // Guard gate: open the in-progress Check + enqueue the durable job (fast —
        // no clone here). Independent of the Code Quality gate below.
        void handlePullRequestGuardGate(
          { store, octokitFor: offerDeps.octokitFor, enqueueGuardGate },
          payload,
        ).catch((err) => reportGithubError(store, 'guard gate enqueue failed', ctx, err));
        // Run the Code Quality gate, then offer the guard spec-change checkbox. A
        // spec-changing PR gets a passive checkbox to regenerate its head's guard
        // scenarios; the auto guard gate above keeps running the baseline corpus.
        void (async () => {
          await handlePullRequestGate(offerDeps, payload).catch((err) =>
            reportGithubError(store, 'gate failed', ctx, err),
          );
          await handlePullRequestGuardSpecOffer(specOfferDeps, payload).catch((err) =>
            reportGithubError(store, 'guard spec offer failed', ctx, err),
          );
        })();
      },
      // On comment edit: the matching handler (by marker) runs its checkbox flow.
      onCommentEdited: (payload) => {
        const ctx = { repo: payload.repository.full_name, pr: payload.issue.number };
        void handleCommentEditedGuardSpec(specOfferDeps, payload).catch((err) =>
          reportGithubError(store, 'comment-edited guard spec failed', ctx, err),
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
export { runBaseline, resolveMergedPr, promoteMergedPrDecisions, type BaselineResult } from './baseline.js';
export { handlePullRequestClosed } from './pr-closed.js';
export { upsertPrState, prStateFromPayload } from './pr-state.js';
export { loadGithubAppConfig } from './config.js';
export {
  createEmailNotifier,
  notifierFromConfig,
  type EmailNotifier,
  type ResendLike,
  type GuardGateFailureEmail,
  type GuardConflictsBlockedEmail,
} from './email.js';
export { wantsNotification } from './notifications.js';
export { repoGuardCoverageUrl } from './links.js';
export { createGithubAuth, getInstallationToken, cloneUrl, type GithubAuth } from './github.js';
export * from './store/index.js';

// Phase 2: spec-doc scan
export {
  isSpecDoc,
  detectSpecDocChanges,
  specScopeFromConfigJson,
  isCodeFile,
  hasCodeChanges,
} from './spec-detect.js';
export { runSpecScan, type SpecScanPipeline } from './spec-scan.js';
export {
  installationOctokit,
  splitRepo,
  findComment,
  updateComment,
  listPrsForCommit,
  getFileContent,
  getPullRequest,
  type OctokitClient,
} from './octokit.js';
export { readRepoDocFromGithub } from './repo-doc.js';
export { createGuardGateHeadsLookup } from './guard-gate-heads.js';

// Code Quality gate
export {
  decideCodeQuality,
  type GateConclusion,
  type GateSeverity,
  type CodeQualityDecision,
  type CodeQualityOptions,
} from './gate.js';
export {
  GATE_MARKER,
  CODE_QUALITY_CHECK_NAME,
  isGateComment,
  renderGateComment,
  cqCheckOutput,
} from './gate-comment.js';
export {
  runGateAnalyze,
  type GateAnalyzeDeps,
  type GateAnalyzeRequest,
  type GateAnalyzeOutput,
} from './gate-runner.js';
export {
  handlePullRequestGate,
  type GateHandlerDeps,
} from './gate-handler.js';

// Guard gate: pure diff/decision + Check output for the PR guard run
export {
  diffGuardRuns,
  decideGuardGate,
  emptyGuardGateDiff,
  type GuardGateInput,
  type GuardGateDiff,
  type GuardGateConclusion,
  type GuardGateDecision,
  type GuardGateOptions,
} from './guard-gate.js';
export {
  GUARD_GATE_CHECK_NAME,
  GUARD_GATE_MAX_ANNOTATIONS,
  GUARD_GATE_KILL_SWITCH_ENV,
  guardGateCheckOutput,
  guardGateDisabled,
  guardGateDisabledOutput,
  capGuardAnnotations,
  type GuardStaleAnnotation,
  type GuardGateCheckOutput,
} from './guard-gate-comment.js';

// Guard gate: the durable `guard.gate` job's pipeline + webhook handler
export {
  createGuardGatePipeline,
  defaultGuardGatePipeline,
  postGuardGateErrorCheck,
  defaultGuardColdGenerate,
  defaultLoadCorpus,
  InvalidGuardRecipeError,
  GUARD_GATE_RUN_TIMEOUT_MS,
  GUARD_GATE_BUILD_TIMEOUT_MS,
  GUARD_GATE_CLONE_TIMEOUT_MS,
  cloneAbortSignal,
  type GuardGateCheckoutRequest,
  type GuardGateClone,
  type GuardGateCorpus,
  type GuardGateLimiter,
  type GuardGatePipeline,
  type GuardGatePipelineDeps,
  type GuardGatePipelineSeams,
  type GuardGatePhase,
  type GuardGateRunOptions,
  type GuardGateRunRequest,
} from './guard-gate-runner.js';
export {
  handlePullRequestGuardGate,
  type EnqueueGuardGate,
  type GuardGateHandlerDeps,
} from './guard-gate-handler.js';

// Guard spec-change checkbox: offer regeneration of the PR head's scenarios
export {
  GUARD_SPEC_MARKER,
  GUARD_SPEC_CHECKBOX_LABEL,
  renderGuardSpecComment,
  isGuardSpecComment,
  isGuardSpecCheckboxChecked,
  type GuardSpecCommentStatus,
  type GuardSpecCommentData,
} from './guard-spec-comment.js';
export {
  handlePullRequestGuardSpecOffer,
  handleCommentEditedGuardSpec,
  buildGuardSpecRegenRequest,
  type GuardSpecOfferDeps,
  type GuardSpecRegenRequest,
  type EnqueueGuardSpecRegen,
} from './guard-spec-offer.js';
export {
  createGuardHeadRegenPipeline,
  defaultGuardHeadRegenPipeline,
  type GuardHeadRegenRequest,
  type GuardHeadRegenResult,
  type GuardHeadRegenDeps,
  type GuardHeadRegenProgress,
  type GuardHeadRegenPipeline,
  type GuardHeadRegenSeams,
} from './guard-head-regen.js';

// Guard baseline refresh: the durable `guard.baseline` job's pipeline (issue 06)
export {
  createGuardBaselinePipeline,
  defaultGuardBaselinePipeline,
  type GuardBaselineRunRequest,
  type GuardBaselinePipeline,
  type GuardBaselinePipelineDeps,
  type GuardBaselinePipelineSeams,
  type GuardBaselinePhase,
  type GuardBaselineRunOptions,
  type GuardBaselineResult,
} from './guard-baseline-runner.js';

// Guard onboarding: hosted guard-scenario generation (the `repo.guard` job body)
export {
  materializeStoredCorpus,
  materializeAndGenerateGuard,
  cloneRepoAtCommit,
  createGuardOnboardingPipeline,
  defaultGuardOnboardingPipeline,
  type GuardGenerateFn,
  type GuardGeneratedCorpus,
  type GuardOnboardingRequest,
  type GuardOnboardingResult,
  type GuardOnboardingDeps,
  type GuardOnboardingProgress,
  type GuardOnboardingPipeline,
  type GuardOnboardingSeams,
} from './guard-onboarding.js';
