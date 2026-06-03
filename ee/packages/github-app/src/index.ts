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
import { runRepoAnalyze } from './analyze.js';
import { createWebhookRouter } from './webhook.js';
import { createConnectRouter } from './connect.js';
import { installationOctokit } from './octokit.js';
import {
  handlePullRequestSpecOffer,
  handleCommentEditedScan,
} from './spec-offer.js';
import {
  handlePullRequestInferOffer,
  handleCommentEditedInfer,
} from './infer-offer.js';
import { handlePullRequestGate } from './gate-handler.js';
import { createEmailNotifier } from './email.js';

export interface RegisterGithubAppOptions {
  /** Dashboard client origin for browser-facing redirects (e.g. /setup). */
  appUrl?: string;
  /** Shared ee-db (Postgres) when hosted; null → the file gate store. */
  db?: EeDb | null;
}

/** Strip any credentials that might appear in a logged message. */
function redactSecrets(msg: string): string {
  return msg
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@')
    .replace(/(extraheader=Authorization:\s*Basic\s+)[A-Za-z0-9+/=]+/gi, '$1***');
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
  };

  // Public: GitHub posts here with no session; verified by HMAC signature.
  registry.registerRouter(
    '/api/ee/github',
    createWebhookRouter({
      secret: cfg.webhookSecret,
      store,
      onBaseline: (trigger) => {
        // Refresh the drift-gate baseline AND run a full analysis for the
        // dashboard — both on a merge to the default branch, both server-side.
        void runBaseline({ store, auth }, trigger).catch((err) => {
          log.error(
            `[github-app] baseline failed for ${trigger.repoFullName}: ${redactSecrets((err as Error).message)}`,
          );
        });
        void runRepoAnalyze({ auth }, trigger).catch((err) => {
          log.error(
            `[github-app] analyze failed for ${trigger.repoFullName}: ${redactSecrets((err as Error).message)}`,
          );
        });
      },
      // On PR open/sync: run the drift gate (Phase 4) and offer the spec scan
      // (Phase 2) + infer run (Phase 3).
      onPullRequest: (payload) => {
        void handlePullRequestGate(offerDeps, payload).catch((err) => {
          log.error(
            `[github-app] gate failed: ${redactSecrets((err as Error).message)}`,
          );
        });
        void handlePullRequestSpecOffer(offerDeps, payload).catch((err) => {
          log.error(
            `[github-app] spec offer failed: ${redactSecrets((err as Error).message)}`,
          );
        });
        void handlePullRequestInferOffer(offerDeps, payload).catch((err) => {
          log.error(
            `[github-app] infer offer failed: ${redactSecrets((err as Error).message)}`,
          );
        });
      },
      // On comment edit: the matching handler (by marker) runs its checkbox flow.
      onCommentEdited: (payload) => {
        void handleCommentEditedScan(offerDeps, payload).catch((err) => {
          log.error(
            `[github-app] comment-edited scan failed: ${redactSecrets((err as Error).message)}`,
          );
        });
        void handleCommentEditedInfer(offerDeps, payload).catch((err) => {
          log.error(
            `[github-app] comment-edited infer failed: ${redactSecrets((err as Error).message)}`,
          );
        });
      },
    }),
    { public: true },
  );

  // Protected: dashboard connect/config endpoints, scoped to the workspace.
  registry.registerRouter(
    '/api/ee/github',
    createConnectRouter({ store, appSlug: cfg.appSlug, appUrl }),
  );

  log.info('[github-app] registered — github-gate on');
  return true;
}

export { loadGithubAppConfig } from './config.js';
export { verifyWebhookSignature } from './signature.js';
export { createWebhookRouter } from './webhook.js';
export type {
  BaselineTrigger,
  PullRequestPayload,
  IssueCommentPayload,
} from './webhook.js';
export { createConnectRouter } from './connect.js';
export { runBaseline } from './baseline.js';
export { createGithubAuth, getInstallationToken, cloneUrl } from './github.js';
export * from './store/index.js';

// Phase 2: spec-doc scan
export {
  isSpecDoc,
  detectSpecDocChanges,
  isCodeFile,
  hasCodeChanges,
} from './spec-detect.js';
export {
  SCAN_MARKER,
  SCAN_CHECKBOX_LABEL,
  renderScanComment,
  isScanComment,
  isScanCheckboxChecked,
  hasScanOffer,
  type ScanCommentStatus,
} from './scan-comment.js';
export { runSpecScan, type SpecScanPipeline } from './spec-scan.js';
export {
  handlePullRequestSpecOffer,
  handleCommentEditedScan,
  type SpecOfferDeps,
} from './spec-offer.js';
export {
  installationOctokit,
  splitRepo,
  findComment,
  type OctokitClient,
} from './octokit.js';

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
export { runInfer, type InferPipeline } from './infer-scan.js';
export {
  handlePullRequestInferOffer,
  handleCommentEditedInfer,
  type InferOfferDeps,
} from './infer-offer.js';

// Phase 4: drift gate
export {
  decideGate,
  type GateConclusion,
  type GateDecision,
  type GateOptions,
  type GateSeverity,
} from './gate.js';
export {
  GATE_MARKER,
  GATE_CHECK_NAME,
  isGateComment,
  renderGateComment,
  gateCheckOutput,
  inlineDriftBody,
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
