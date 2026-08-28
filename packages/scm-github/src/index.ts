/**
 * GitHub App connection layer: everything needed to install the App, receive its
 * webhooks and connect repositories to a workspace. What a connected repo is then
 * USED for (the PR gate, baselines, guard runs) lives in its own package and rides
 * the seams declared here — `onRepoLinked` on the connect router and the handler
 * hooks on the webhook router.
 */

export { loadGithubAppConfig, type GithubAppConfig } from './config.js';
export { verifyWebhookSignature } from './signature.js';
export {
  createGithubAuth,
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
export {
  installationOctokit,
  splitRepo,
  listPrFiles,
  getFileContent,
  findComment,
  getActorPermission,
  createComment,
  updateComment,
  findActiveCheck,
  startCheck,
  postCheck,
  listReviewComments,
  createReviewComment,
  listOpenPrs,
  listPrsForCommit,
  getPullRequest,
  type OctokitClient,
  type RepoCoords,
  type CheckConclusion,
  type CheckAnnotation,
} from './octokit.js';
export {
  NOTIFICATION_KEYS,
  resolveNotificationPrefs,
  wantsNotification,
} from './notifications.js';
export {
  createWebhookRouter,
  type WebhookDeps,
  type BaselineTrigger,
  type PullRequestPayload,
  type IssueCommentPayload,
} from './webhook.js';
export { createConnectRouter, type ConnectDeps, type OnRepoLinked } from './connect.js';
export type {
  GateStore,
  InstallationRecord,
  RepoLinkRecord,
  BaselineRecord,
  PrState,
  PrRecord,
  GateRunRecord,
} from './store/types.js';
export { PostgresGateStore, type GateDb } from './store/pg-store.js';
