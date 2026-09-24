/**
 * What an edition bundle is built against: the shapes of the features it
 * exports for the open server's entry to register. This is the ONLY module of
 * this server another package imports, and only for types — the bundle never
 * starts the server or reaches its registry itself. What a feature may DO
 * beyond mounting a router is handed to it in its context (reporting an action,
 * announcing a Context change), so nothing here is a value.
 */

export type {
  FeatureContextDriver,
  ServerFeature,
  ServerFeatureContext,
  ServerRouterMount,
} from './features.js';
export type {
  MintedSession,
  SignedInSession,
  WorkspaceSessionTools,
} from './auth/index.js';
export type { ContextChange } from './services/context.service.js';
export type { ServerAnalyticsEvent } from './observability/posthog.js';
