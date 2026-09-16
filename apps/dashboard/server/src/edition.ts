/**
 * What an edition bundle is built against: the shapes of the features it
 * exports for the open server's entry to register. This is the ONLY module of
 * this server another package imports, and only for types — the bundle never
 * starts the server or reaches its registry itself.
 */

export type {
  ServerFeature,
  ServerFeatureContext,
  ServerRouterMount,
} from './features.js';
export type {
  MintedSession,
  SignedInSession,
  WorkspaceSessionTools,
} from './auth/index.js';
