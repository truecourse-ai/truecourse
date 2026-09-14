/**
 * The dashboard's auth layer, assembled once at boot.
 *
 * `createAuth()` reads the WorkOS env (throwing if it is incomplete), builds
 * the WorkOS client, and derives the ONE session verifier that both the auth
 * gate and the public auth routes share.
 */

import { WorkOS } from '@workos-inc/node';
import type { Router } from 'express';
import type { AuthVerifier } from '@truecourse/shared';
import { loadWorkosConfig, type WorkosConfig } from './config.js';
import {
  createAuthRouter,
  createSessionVerifier,
  createWorkspaceSessionTools,
  type WorkspaceSessionTools,
} from './workos-auth.js';
import { createWorkspaceMembersRouter } from './workspace-members.js';

export { loadWorkosConfig, type WorkosConfig } from './config.js';
export { parseCookies, serializeCookie } from './cookies.js';
export {
  createAuthRouter,
  createSessionVerifier,
  createWorkspaceSessionTools,
  SESSION_COOKIE,
  type MintedSession,
  type SignedInSession,
  type WorkspaceSessionTools,
} from './workos-auth.js';
export { createWorkspaceMembersRouter } from './workspace-members.js';

export interface Auth {
  config: WorkosConfig;
  /** The single verifier — handed to the gate AND already bound into `router`. */
  verify: AuthVerifier;
  /** Public auth routes; mount at `/api/auth`, before the gate. */
  router: Router;
  /**
   * The workspace's people, read from the same WorkOS client. Mount at
   * `/api/workspace`, BEHIND the gate: every route here is the session's
   * organization's.
   */
  members: Router;
  /**
   * What a route that moves the session between organizations is built from.
   * Nothing in the open edition uses it: one workspace has nowhere to move to.
   */
  workspaceSession: WorkspaceSessionTools;
}

export function createAuth(): Auth {
  const config = loadWorkosConfig();
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });
  const verify = createSessionVerifier(workos, config);
  return {
    config,
    verify,
    router: createAuthRouter(workos, config, verify),
    members: createWorkspaceMembersRouter(workos),
    workspaceSession: createWorkspaceSessionTools(workos, config),
  };
}
