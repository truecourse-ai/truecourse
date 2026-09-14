/**
 * What an edition bundle is built against: the registry it adds its routers to,
 * and the server it then starts. This is the ONLY module of this server another
 * package imports.
 */

export { runServer, startServer } from './boot.js';
export {
  registerServerFeature,
  type ServerFeature,
  type ServerFeatureContext,
  type ServerRouterMount,
} from './features.js';
export type {
  MintedSession,
  SignedInSession,
  WorkspaceSessionTools,
} from './auth/index.js';
