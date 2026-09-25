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
 * Everything downstream takes the same things either way — a verifier, a
 * public router, the workspace's people, and the gate `/mcp` sits behind — so
 * no route, tool, job or store knows which mode it is running in.
 */

import { WorkOS } from '@workos-inc/node';
import { Router } from 'express';
import { createRemoteJWKSet } from 'jose';
import type { AuthVerifier, ServerMode, WorkspaceInviteLinkStore } from '@truecourse/shared';
import { loadWorkosConfig } from './config.js';
import { createInviteLinkRouter } from './invite-links.js';
import {
  createAuthRouter,
  createMembershipCheck,
  createSessionVerifier,
  createWorkspaceSessionTools,
  type WorkspaceSessionTools,
} from './workos-auth.js';
import {
  createHostedMcpAuth,
  createLocalMcpAuth,
  loadMcpOAuthConfig,
  type McpAuth,
} from './mcp.js';
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
export {
  createHostedMcpAuth,
  createLocalMcpAuth,
  loadMcpOAuthConfig,
  type HostedMcpAuthOptions,
  type McpAuth,
  type McpOAuthConfig,
} from './mcp.js';

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
  /**
   * How a request to `/mcp` becomes a session. Null on a hosted server whose
   * MCP sign-in is not configured (`WORKOS_AUTHKIT_DOMAIN`, `TRUECOURSE_MCP_URL`).
   */
  mcp: McpAuth | null;
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
      mcp: createLocalMcpAuth(),
    };
  }
  const config = loadWorkosConfig();
  const mcpConfig = loadMcpOAuthConfig();
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });
  const verify = createSessionVerifier(workos, config);
  const workspaceSession = createWorkspaceSessionTools(workos, config);
  const mcp = mcpConfig
    ? createHostedMcpAuth({
        issuer: mcpConfig.issuer,
        resource: mcpConfig.resource,
        keys: createRemoteJWKSet(new URL('/oauth2/jwks', mcpConfig.issuer)),
        isMember: createMembershipCheck(workos),
      })
    : null;
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
    mcp,
  };
}
