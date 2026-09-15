/**
 * GitHub App connection layer: everything needed to install the App, receive its
 * webhooks and connect repositories to a workspace. What a connected repo is then
 * USED for (baselines, guard runs) lives in its own package and rides the seams
 * declared here — `onRepoLinked` on the connect router and the handler hooks on
 * the webhook router.
 */

export { loadGithubAppConfig, type GithubAppConfig } from './config.js';
export { verifyWebhookSignature } from './signature.js';
export {
  createGithubAuth,
  getInstallationToken,
  repoWebUrl,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
export {
  installationOctokit,
  appOctokit,
  fetchInstallationAccount,
  splitRepo,
  type OctokitClient,
  type RepoCoords,
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
  type SourcePushTrigger,
} from './webhook.js';
export {
  createConnectRouter,
  type ConnectDeps,
  type OnRepoLinked,
  type OnRepoUnlinked,
} from './connect.js';
export { GITHUB_PROVIDER, installationOf } from './provider.js';
export type { InstallationStore, InstallationRecord } from './store/types.js';
export { PostgresInstallationStore, type InstallationDb } from './store/pg-store.js';
