/**
 * The dashboard's auth layer, assembled once at boot.
 *
 * There are two answers, and which one a server gives is a deployment decision
 * it is TOLD (see `../mode.ts`), never one it guesses. Hosted: `createAuth()`
 * reads the WorkOS env (throwing if it is incomplete), builds the WorkOS
 * client, and derives the ONE session verifier that both the auth gate and the
 * public auth routes share. Local: there is nobody to authenticate, so the
 * verifier answers the machine's one implicit session and no WorkOS client is
 * built at all (see `./local.ts`).
 *
 * Everything downstream takes the same three things either way — a verifier, a
 * public router, the workspace's people — so no route, job or store knows which
 * mode it is running in.
 */

import { WorkOS } from '@workos-inc/node';
import { Router } from 'express';
import type { AuthVerifier, ServerMode, WorkspaceInviteLinkStore } from '@truecourse/shared';
import { loadWorkosConfig } from './config.js';
import { createInviteLinkRouter } from './invite-links.js';
import {
  createAuthRouter,
  createSessionVerifier,
  createWorkspaceSessionTools,
  type WorkspaceSessionTools,
} from './workos-auth.js';
import {
  createLocalAuthRouter,
  createLocalSessionVerifier,
  createLocalWorkspaceMembersRouter,
} from './local.js';
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
export {
  LOCAL_ORG_ID,
  LOCAL_USER_ID,
  createLocalAuthRouter,
  createLocalSessionVerifier,
  createLocalWorkspaceMembersRouter,
  localUser,
} from './local.js';
export { createWorkspaceMembersRouter } from './workspace-members.js';

export interface Auth {
  mode: ServerMode;
  /** The single verifier — handed to the gate AND already bound into `router`. */
  verify: AuthVerifier;
  /** Public auth routes; mount at `/api/auth`, before the gate. */
  router: Router;
  /**
   * The workspace's people. Mount at `/api/workspace`, BEHIND the gate: every
   * route here is the session's organization's.
   */
  members: Router;
  /**
   * What a route that moves the session between organizations is built from.
   * Nothing in the open edition uses it: one workspace has nowhere to move to.
   * Null in local mode, where there is no identity provider to move through.
   */
  workspaceSession: WorkspaceSessionTools | null;
}

export interface AuthDeps {
  /** Where the hosted edition keeps its invite links; local mode issues none. */
  inviteLinks: WorkspaceInviteLinkStore;
  /** Whether this edition lets one person be in more than one workspace. */
  manyWorkspaces: boolean;
}

export function createAuth(mode: ServerMode, deps: AuthDeps): Auth {
  if (mode === 'local') {
    return {
      mode,
      verify: createLocalSessionVerifier(),
      router: createLocalAuthRouter(),
      members: createLocalWorkspaceMembersRouter(),
      workspaceSession: null,
    };
  }
  const config = loadWorkosConfig();
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });
  const verify = createSessionVerifier(workos, config);
  const workspaceSession = createWorkspaceSessionTools(workos, config);
  return {
    mode,
    verify,
    router: Router()
      .use(createAuthRouter(workos, config, verify))
      .use(
        createInviteLinkRouter({
          verify,
          tools: workspaceSession,
          inviteLinks: deps.inviteLinks,
          manyWorkspaces: deps.manyWorkspaces,
        }),
      ),
    members: createWorkspaceMembersRouter(workos, config, deps.inviteLinks),
    workspaceSession,
  };
}
